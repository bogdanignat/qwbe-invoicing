import assert from "node:assert/strict"
import test from "node:test"

import { maintenanceLockKey, tryAcquireMaintenanceLock } from "./postgres-maintenance-lock.ts"
import { startMaintenanceSession } from "./postgres-maintenance-session.ts"
import { createQueryPool } from "./postgres-pool.ts"
import { freshRuntime, rigMaintenanceDatabase, testSettings } from "./postgres-rig.test-support.ts"
import { appliedOrder, resetFingerprintCache, schemaDrift } from "./postgres-schema-fingerprint.ts"
import { introspectSchema } from "./postgres-schema-introspection.ts"

/**
 * The lifetime barrier and the drift replay, on a real PostgreSQL 16 server.
 * Everything here is observed: the lock is taken, killed and retaken, and the
 * fingerprint is compared against a schema that was edited behind its back.
 */

const settled = (millis: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, millis) })

void test("the barrier is held after start and blocks an exclusive taker", async () => {
  const runtime = await freshRuntime("barrier_hold")
  try {
    const session = await startMaintenanceSession(runtime.maintenance, { keepaliveMillis: 200 })
    try {
      assert.equal(session.held(), true)
      assert.equal(session.state(), "held")
      // A maintenance command must refuse while the application holds it shared.
      const client = await runtime.pool.connect()
      try {
        assert.equal(await tryAcquireMaintenanceLock(client), false)
      } finally {
        client.release()
      }
    } finally {
      await session.release()
    }
    // Released: the exclusive taker now succeeds, so nothing leaked.
    const after = await runtime.pool.connect()
    try {
      assert.equal(await tryAcquireMaintenanceLock(after), true)
    } finally {
      after.release()
    }
  } finally {
    await runtime.close()
  }
})

void test("release is idempotent and safe to call twice", async () => {
  const runtime = await freshRuntime("barrier_release")
  try {
    const session = await startMaintenanceSession(runtime.maintenance, { keepaliveMillis: 200 })
    await session.release()
    await session.release()
    assert.equal(session.held(), false)
    assert.equal(session.state(), "released")
  } finally {
    await runtime.close()
  }
})

void test("a terminated backend loses the barrier and takes it again", async () => {
  const runtime = await freshRuntime("barrier_recovery")
  const session = await startMaintenanceSession(runtime.maintenance, {
    keepaliveMillis: 150,
    retryDelayMillis: 100,
    maxRetryDelayMillis: 300,
  })
  try {
    assert.equal(session.held(), true)
    // Kill exactly the backend that holds the lock, from another connection, and
    // only the one in THIS database. `pg_locks` is cluster-wide: the barrier key
    // is a constant, every test file on the rig takes it in its own database, and
    // four files are in flight under `--test-concurrency=4`. A terminate by key
    // alone therefore kills other files' sessions — it did, and
    // `postgres-runtime.test.ts` died with `Connection terminated unexpectedly`
    // while passing on its own. The identity used here is the full one:
    // `classid`/`objid` plus `objsubid = 2` (the two-key advisory form) plus the
    // lock's own database, cross-checked against `pg_stat_activity`.
    // Both pools are built by the production builder, with `maxConnections: 1`.
    // A raw `new Pool({ ...testSettings(...) })` would drop every camelCase bound
    // (`pg` reads `statement_timeout`, `lock_timeout`,
    // `idle_in_transaction_session_timeout`), so the peer below would wait for the
    // shared maintenance key with no bound at all, and neither pool would carry
    // the `error` listener that keeps a server-dropped idle client from ending the
    // whole `node --test` process.
    const poolErrors: Array<string> = []
    const reportPoolError = (message: string): void => {
      // Bounded: a flapping pool must not grow an unbounded array or an unbounded
      // log, and the test asserts on the first few entries only.
      if (poolErrors.length < 8) poolErrors.push(message)
    }
    const peer = createQueryPool({
      ...testSettings(rigMaintenanceDatabase()),
      maxConnections: 1,
      onPoolError: reportPoolError,
    })
    const killer = createQueryPool({
      ...testSettings(runtime.database),
      maxConnections: 1,
      onPoolError: reportPoolError,
    })
    try {
      // A peer holding the very same advisory key in another database. It must
      // survive, or the filter below is decoration.
      const peerClient = await peer.connect()
      try {
        // Every bound is in force on this session, read back from the server: an
        // unbounded peer is the hang this fixture exists to rule out.
        const bounds = await peerClient.query<{ readonly name: string; readonly setting: string }>(
          "SELECT name, setting FROM pg_settings WHERE name IN"
          + " ('statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout')",
        )
        assert.equal(bounds.rowCount, 3)
        for (const { name, setting } of bounds.rows) {
          assert.ok(Number(setting) > 0, `peer pool: ${name} must be bounded, got ${setting}`)
        }
        // The maintenance database is shared by every file in flight, so the key
        // is taken with `pg_try_advisory_lock` and a bounded number of attempts:
        // a contended key fails here with a message instead of waiting.
        let acquired = false
        for (let attempt = 0; attempt < 20 && !acquired; attempt += 1) {
          acquired = (await peerClient.query<{ readonly locked: boolean }>(
            "SELECT pg_try_advisory_lock($1::integer, $2::integer) AS locked",
            [maintenanceLockKey.classId, maintenanceLockKey.objectId],
          )).rows[0]?.locked === true
          if (!acquired) await settled(100)
        }
        assert.equal(acquired, true, "the peer should take the barrier key in the maintenance database")
        const peerPid = Number((await peerClient.query<{ readonly pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        )).rows[0]?.pid)

        const holders = await killer.query<{ readonly pid: number }>(
          "SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid"
          + " WHERE l.locktype = 'advisory' AND l.classid = $1 AND l.objid = $2"
          + " AND l.objsubid = 2 AND l.granted"
          + " AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())"
          + " AND a.datname = current_database()",
          [maintenanceLockKey.classId, maintenanceLockKey.objectId],
        )
        assert.equal(holders.rowCount, 1, "exactly one backend in this database should hold the barrier")
        const target = holders.rows[0]?.pid
        assert.ok(typeof target === "number" && target !== peerPid, "the target must not be the peer's backend")
        assert.equal(
          (await killer.query<{ readonly terminated: boolean }>(
            "SELECT pg_terminate_backend($1::integer) AS terminated",
            [target],
          )).rows[0]?.terminated,
          true,
        )
        // The peer's connection is still usable, and still the same backend: the
        // kill did not travel across databases.
        assert.equal(
          Number((await peerClient.query<{ readonly pid: number }>(
            "SELECT pg_backend_pid() AS pid",
          )).rows[0]?.pid),
          peerPid,
          "a client holding the same advisory key in another database must stay alive",
        )
        await peerClient.query(
          "SELECT pg_advisory_unlock($1::integer, $2::integer)",
          [maintenanceLockKey.classId, maintenanceLockKey.objectId],
        )
      } finally {
        peerClient.release()
      }
    } finally {
      await killer.end()
      await peer.end()
    }
    // A pool error here would be an idle client the server dropped — reported,
    // never swallowed.
    assert.deepEqual(poolErrors, [])
    // held() goes false on evidence, not on a timer.
    let lost = false
    for (let attempt = 0; attempt < 40 && !lost; attempt += 1) {
      await settled(100)
      lost = !session.held()
    }
    assert.equal(lost, true, "the barrier should be reported lost after the backend is terminated")
    // And it comes back by itself: no permanent 503 after the server recovers.
    let regained = false
    for (let attempt = 0; attempt < 40 && !regained; attempt += 1) {
      await settled(100)
      regained = session.held()
    }
    assert.equal(regained, true, "the barrier should be re-acquired with backoff")
  } finally {
    await session.release()
    await runtime.close()
  }
})

void test("drift is empty on a freshly migrated database and the replay leaves nothing behind", async () => {
  const runtime = await freshRuntime("drift_clean")
  try {
    resetFingerprintCache()
    const applied = await appliedOrder(runtime.pool)
    assert.ok(applied.length > 0, "the ledger should list the applied migrations")
    assert.deepEqual(await schemaDrift(runtime.pool), [])
    // The scratch schema was rolled back: no qwbe_drift_* schema survives.
    const { rows } = await runtime.pool.query<{ readonly count: string }>(
      "SELECT count(*) AS count FROM pg_namespace WHERE nspname LIKE 'qwbe_drift_%'",
    )
    assert.equal(rows[0]?.count, "0")
  } finally {
    await runtime.close()
  }
})

void test("an edited trigger function body is reported as drift", async () => {
  const runtime = await freshRuntime("drift_function")
  try {
    resetFingerprintCache()
    assert.deepEqual(await schemaDrift(runtime.pool), [])
    // The foundation function, replaced behind the ledger's back.
    await runtime.pool.query(
      "CREATE OR REPLACE FUNCTION qwbe_abort() RETURNS trigger LANGUAGE plpgsql AS $qwbe$"
      + " BEGIN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='edited'; END $qwbe$",
    )
    resetFingerprintCache()
    const drifted = await schemaDrift(runtime.pool)
    assert.ok(
      drifted.some((name) => name.startsWith("function:qwbe_abort")),
      `the function body should be reported as drift, got ${JSON.stringify(drifted)}`,
    )
  } finally {
    await runtime.close()
  }
})

void test("the introspection ignores the ledger and sees the domain tables", async () => {
  const runtime = await freshRuntime("introspect")
  try {
    const client = await runtime.pool.connect()
    try {
      const objects = await introspectSchema(client, "public")
      const names = objects.map((object) => object.name)
      assert.ok(names.includes("table:issued_invoices"))
      assert.ok(names.includes("table:browser_sessions"))
      assert.ok(!names.includes("table:schema_migrations"), "the ledger is bookkeeping, not schema")
      assert.ok(names.some((name) => name.startsWith("trigger:")))
      assert.ok(names.some((name) => name.startsWith("constraint:")))
    } finally {
      client.release()
    }
  } finally {
    await runtime.close()
  }
})
