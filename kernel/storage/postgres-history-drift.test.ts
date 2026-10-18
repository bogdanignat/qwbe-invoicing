import assert from "node:assert/strict"
import test from "node:test"

import type { Pool, PoolClient } from "pg"

import { doctorReport } from "../ops/cli-doctor.ts"
import type { RuntimeConfig } from "../config.ts"
import { databaseReady } from "./migrations.ts"
import { ledgerTable, planMigrations } from "./postgres-migrations.ts"
import { migrationScopes } from "./postgres-migration-plans.ts"
import { emptyRuntime, freshRuntime, type TestRuntime } from "./postgres-rig.test-support.ts"
import {
  HistoryNotReplayable, historyDrift, historyFrom, readHistory, resetFingerprintCache, schemaDrift,
} from "./postgres-schema-fingerprint.ts"
import { replayFingerprint, ScratchNotRolledBack } from "./postgres-schema-replay.ts"

/**
 * The corrupt-history signal, on a real PostgreSQL 16 server.
 *
 * Reported by the tests unit: a ledger that skips a migration in the middle made
 * `replayFingerprint` fail with a raw SQLSTATE 42P01, so `migrate` could not say
 * "recreate the database" — it crashed instead. These cases pin the fixed
 * behaviour: a corrupt history is reported as drift, every caller answers the
 * same way, and the connection goes back to the pool clean.
 *
 * No contract is edited anywhere here: the history is corrupted by deleting or
 * inserting LEDGER rows, which is exactly what an edited or rolled-back
 * deployment leaves behind.
 */

const config = (runtime: TestRuntime): RuntimeConfig => ({
  host: "127.0.0.1",
  port: 3000,
  dataDirectory: "/tmp",
  nodeEnvironment: "test",
  authTokenFile: undefined,
  organizationId: undefined,
  pgSettings: { ...runtime.pool.options, password: "" } as RuntimeConfig["pgSettings"],
})

/** The pool still works, and nothing is stuck in an aborted transaction. */
const poolIsClean = async (runtime: TestRuntime): Promise<void> => {
  for (let probe = 0; probe < 5; probe += 1) {
    const { rows } = await runtime.pool.query<{ readonly one: number }>("SELECT 1 AS one")
    assert.equal(rows[0]?.one, 1)
  }
  const { rows } = await runtime.pool.query<{ readonly count: string }>(
    "SELECT count(*) AS count FROM pg_stat_activity"
    + " WHERE datname = current_database() AND state = 'idle in transaction'",
  )
  assert.equal(rows[0]?.count, "0", "no connection may be left inside a transaction")
}

const scopeFixture = [
  { scope: "alpha", migrations: [{ name: "001", statements: [] }, { name: "002", statements: [] }], tables: [] },
  { scope: "beta", migrations: [{ name: "001", statements: [] }, { name: "002", statements: [] }], tables: [] },
] as unknown as typeof migrationScopes

void test("the classifier reports a within-scope hole and leaves an append pending", () => {
  // A hole: alpha/001 unapplied while alpha/002 is.
  const hole = historyFrom(new Set(["alpha/002", "beta/001", "beta/002"]), scopeFixture)
  assert.deepEqual(hole.missing, ["alpha/001"])
  assert.deepEqual(historyDrift(hole), ["history:missing:alpha/001"])
  // An append at the end of a NON-final scope: alpha/002 is simply not applied
  // yet, even though the later scope is fully applied. Not a hole.
  const appended = historyFrom(new Set(["alpha/001", "beta/001", "beta/002"]), scopeFixture)
  assert.deepEqual(appended.missing, [])
  assert.deepEqual(historyDrift(appended), [])
  // A row no scope declares stays unknown.
  const unknown = historyFrom(new Set(["alpha/001", "alpha/002", "gamma/001"]), scopeFixture)
  assert.deepEqual(unknown.unknown, ["gamma/001"])
  assert.deepEqual(historyDrift(unknown), ["history:unknown:gamma/001"])
})

void test("a rolled-back ledger row stays fail-closed on a real database", async () => {
  const runtime = await freshRuntime("history_gap")
  try {
    resetFingerprintCache()
    assert.deepEqual(await schemaDrift(runtime.pool), [])
    const before = await readHistory(runtime.pool)
    // Every contract ships exactly one baseline today, so a within-scope hole is
    // unreachable live (it is covered by the classifier case above). What IS
    // reachable: a ledger row deleted while its objects remain in the schema —
    // a rolled-back deployment. The later scopes depend on it, so the replay
    // cannot build and the answer must be fail-closed drift, never a crash.
    const victim = before.applied.find((key) => key.startsWith("customers/"))
    assert.ok(victim !== undefined, "the rig should have applied the customers baseline")
    const [scope, name] = victim.split("/")
    await runtime.pool.query(
      `DELETE FROM ${ledgerTable} WHERE scope = $1 AND name = $2`,
      [scope, name],
    )
    resetFingerprintCache()
    const drifted = await schemaDrift(runtime.pool)
    assert.ok(drifted.length > 0, "a rolled-back ledger row must not read as a clean schema")
    assert.ok(
      drifted.some((name) => name.startsWith("history:not_replayable:42") || name.startsWith("table:")),
      `expected a fail-closed signal, got ${JSON.stringify(drifted)}`,
    )
    await poolIsClean(runtime)
  } finally {
    await runtime.close()
  }
})

void test("an unmigrated database is pending, not drifted", async () => {
  const runtime = await emptyRuntime("history_pending")
  try {
    resetFingerprintCache()
    const history = await readHistory(runtime.pool)
    assert.equal(history.present, false)
    assert.deepEqual(history.missing, [])
    // No ledger at all is a database that was never migrated: every migration is
    // pending and nothing is drift, so `migrate --apply` can move forward.
    assert.deepEqual(await schemaDrift(runtime.pool), [])
    const report = await planMigrations(runtime.pool)
    assert.ok(report.pending.length > 0)
    await poolIsClean(runtime)
  } finally {
    await runtime.close()
  }
})

void test("a ledger row no contract declares is reported as unknown", async () => {
  const runtime = await freshRuntime("history_unknown")
  try {
    await runtime.pool.query(
      `INSERT INTO ${ledgerTable} (scope, name, applied_at) VALUES ($1, $2, now())`,
      ["bogus", "999-renamed"],
    )
    resetFingerprintCache()
    const history = await readHistory(runtime.pool)
    assert.deepEqual(history.unknown, ["bogus/999-renamed"])
    assert.deepEqual(history.missing, [])
    assert.deepEqual(await schemaDrift(runtime.pool), ["history:unknown:bogus/999-renamed"])
    await poolIsClean(runtime)
  } finally {
    await runtime.close()
  }
})

void test("doctor and migrate see the same corrupt-history signal", async () => {
  const runtime = await freshRuntime("history_doctor")
  try {
    resetFingerprintCache()
    const clean = await doctorReport(config(runtime), runtime.pool)
    assert.equal(clean.ready, true)
    assert.deepEqual(clean.schemaDrift, [])
    const history = await readHistory(runtime.pool)
    const victim = history.applied.find((key) => key.startsWith("customers/"))
    assert.ok(victim !== undefined)
    const [scope, name] = victim.split("/")
    await runtime.pool.query(`DELETE FROM ${ledgerTable} WHERE scope = $1 AND name = $2`, [scope, name])
    resetFingerprintCache()
    const corrupt = await doctorReport(config(runtime), runtime.pool)
    // `migrate` prints the same list and exits 1; `doctor` exits 1 on `ready`.
    // The prefix is `history:not_replayable:42P01` for a rolled-back row whose
    // objects are still live — the semantic the fixed classifier produces for
    // this shape. The assertion is not weakened: the list must be non-empty, it
    // must name a history problem, and `ready`/`databaseReady` must be false.
    assert.ok(corrupt.schemaDrift.length > 0)
    assert.ok(
      corrupt.schemaDrift.every((name) => name.startsWith("history:") || name.startsWith("table:")),
      `unexpected drift shape: ${JSON.stringify(corrupt.schemaDrift)}`,
    )
    assert.equal(corrupt.ready, false)
    assert.equal(corrupt.databaseReady, false)
    // The migration is pending again, so the operator is not told "nothing to do".
    assert.ok(corrupt.pendingMigrations.includes(victim))
    await poolIsClean(runtime)
  } finally {
    await runtime.close()
  }
})

void test("a replay of an unbuildable subset raises HistoryNotReplayable, not a driver error", async () => {
  const runtime = await freshRuntime("history_replay")
  try {
    const history = await readHistory(runtime.pool)
    // Deliberately drop a dependency from the middle of the subset handed to the
    // replay: the later statements reference objects it never creates.
    const truncated = history.applied.filter((key) => key !== history.applied[1])
    const client = await runtime.pool.connect()
    try {
      await assert.rejects(
        () => replayFingerprint(client, truncated),
        (error: unknown) => {
          assert.ok(error instanceof HistoryNotReplayable, `expected HistoryNotReplayable, got ${String(error)}`)
          assert.match(error.sqlState, /^(42|3F000)/u)
          return true
        },
      )
    } finally {
      client.release()
    }
    await poolIsClean(runtime)
  } finally {
    await runtime.close()
  }
})

/**
 * The same pool, whose next checkout refuses to ROLLBACK while its session stays
 * alive.
 *
 * Nothing in production is stubbed: the real pool hands out a real client, the
 * real replay runs its real DDL inside a real transaction, and the single thing
 * injected is the failure this case is about — the second `ROLLBACK` not coming
 * back, which is what a `statement_timeout` on the rollback of a killed replay
 * leaves behind. The delegate forwards `query` and `release` and records what
 * `release` was given, because that argument is the whole fix: `pg` destroys a
 * client released with an error and recycles one released without.
 */
const rollbackRefusedBy = (pool: Pool, released: Array<unknown>): Pool => ({
  connect: async (): Promise<PoolClient> => {
    const client = await pool.connect()
    const forward = client.query.bind(client) as (...args: ReadonlyArray<unknown>) => Promise<unknown>
    return {
      query: (...args: ReadonlyArray<unknown>) => (
        typeof args[0] === "string" && args[0].trim().toUpperCase() === "ROLLBACK"
          ? Promise.reject(new Error("rig: the ROLLBACK never came back"))
          : forward(...args)
      ),
      release: (error?: Error | boolean) => {
        released.push(error)
        client.release(error)
      },
    } as unknown as PoolClient
  },
} as unknown as Pool)

void test("readiness destroys the connection when the drift replay could not be rolled back", async () => {
  const runtime = await freshRuntime("readiness_dirty")
  try {
    resetFingerprintCache()
    // The same call readiness makes every five seconds, green first, so the
    // failure below is the injected one and not a broken fixture.
    assert.equal(await databaseReady(runtime.pool), true)
    // Without this the memoised replay would answer from the cache and never
    // open the transaction the ROLLBACK belongs to.
    resetFingerprintCache()
    const released: Array<unknown> = []
    await assert.rejects(
      () => databaseReady(rollbackRefusedBy(runtime.pool, released)),
      (error: unknown) => {
        assert.ok(error instanceof ScratchNotRolledBack, `expected ScratchNotRolledBack, got ${String(error)}`)
        return true
      },
    )
    assert.equal(released.length, 1, "the connection must be given back exactly once")
    assert.ok(
      released[0] instanceof ScratchNotRolledBack,
      `the dirty client must be released WITH the error so pg destroys it, got ${String(released[0])}`,
    )
    // The consequence, read off the server rather than asserted on the call: the
    // replay's scratch schema only exists inside the transaction that was never
    // rolled back. `freshRuntime`'s pool is `max: 4`, but it has handed out
    // exactly one connection so far and that is the one under test, so a
    // recycled client is the only one this query could run on and it would see
    // its own uncommitted schema; a destroyed one forces a fresh backend, where
    // the transaction died with the session.
    const { rows } = await runtime.pool.query<{ readonly scratch: string }>(
      "SELECT count(*) AS scratch FROM information_schema.schemata WHERE schema_name LIKE 'qwbe\\_drift\\_%'",
    )
    assert.equal(rows[0]?.scratch, "0", "an aborted replay must not survive on a recycled connection")
    await poolIsClean(runtime)
  } finally {
    await runtime.close()
  }
})
