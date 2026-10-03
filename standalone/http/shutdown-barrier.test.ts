import assert from "node:assert/strict"
import test from "node:test"

import {
  maintenanceLockKey,
  releaseMaintenanceLock,
  tryAcquireMaintenanceLock,
} from "../storage/postgres-maintenance-lock.ts"
import { startMaintenanceSession } from "../storage/postgres-maintenance-session.ts"
import { createQueryPool } from "../storage/postgres-pool.ts"
import { freshRuntime, testSettings, type TestRuntime } from "../storage/postgres-rig.test-support.ts"
import { businessLockKey } from "../storage/postgres-transaction.ts"
import { runShutdown } from "./shutdown.ts"

/**
 * What the barrier really guarantees during a failed shutdown, measured on a
 * live PostgreSQL 16 server with the production `runShutdown`, the production
 * `startMaintenanceSession` and the production pools.
 *
 * Two separate claims are pinned here, because one of them was asserted in
 * review and does not hold:
 *
 * 1. **A live writer alone already refuses maintenance.** Every transaction
 *    takes `pg_advisory_xact_lock_shared` on the maintenance key as its first
 *    statement (`postgres-transaction.ts:147`, `browser-session-store.ts:49-52`)
 *    and a transaction-scoped lock is held until COMMIT/ROLLBACK, so
 *    `migrate`/`backup`/`restore` — which take the same key EXCLUSIVE with
 *    `pg_try_advisory_lock`, no wait — are refused by the writer itself, with or
 *    without the application's session-level hold. "The session barrier was
 *    released, therefore DDL can run next to a live write" is false, and the
 *    first case below is the falsification.
 * 2. **The session hold is still not given up while this process can write.**
 *    That is a real invariant and it is not earned by destroying sockets: a
 *    destroyed socket does not end the request behind it. It is earned by
 *    ending the query pool, which waits for the checked-out clients and then
 *    refuses the next one. The second case holds a writer open behind a gate,
 *    makes the drain reject, and shows the sequence waiting there with the
 *    barrier still held and the pool already refusing new work — then settling
 *    at 1 once the writer commits.
 *
 * Nothing is mocked and nothing in production is parameterised for the test:
 * only `drain` is injected, which is the failure a child process cannot be made
 * to produce.
 */

/** Generous against a loaded rig, bounded so a hang fails instead of stalling. */
const settleMillis = 15_000

/** A separate connection, so the probe is never the pool under test. */
const peer = (runtime: TestRuntime) =>
  createQueryPool({ ...testSettings(runtime.database), maxConnections: 1 })

/** Whether a maintenance command would get the barrier right now. Gives it back. */
const maintenanceWouldStart = async (runtime: TestRuntime): Promise<boolean> => {
  const pool = peer(runtime)
  try {
    const client = await pool.connect()
    try {
      const taken = await tryAcquireMaintenanceLock(client)
      if (taken) await releaseMaintenanceLock(client)
      return taken
    } finally {
      client.release()
    }
  } finally {
    await pool.end()
  }
}

/** An open write transaction on the application pool, held until `commit()`. */
const gatedWriter = async (runtime: TestRuntime): Promise<{ readonly commit: () => Promise<void> }> => {
  const client = await runtime.pool.connect()
  await client.query("BEGIN ISOLATION LEVEL READ COMMITTED")
  await client.query(
    "SELECT pg_advisory_xact_lock_shared($1,$2)",
    [maintenanceLockKey.classId, maintenanceLockKey.objectId],
  )
  await client.query("SELECT pg_advisory_xact_lock($1,$2)", [businessLockKey.classId, businessLockKey.objectId])
  return {
    commit: async () => {
      await client.query("COMMIT")
      client.release()
    },
  }
}

const settled = async <Value>(running: Promise<Value>): Promise<Value> => {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => { resolve("timeout") }, settleMillis)
  })
  try {
    const outcome = await Promise.race([running, timeout])
    assert.notEqual(outcome, "timeout", `the shutdown did not settle within ${String(settleMillis)}ms`)
    return outcome as Value
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

void test("a live writer refuses maintenance on its own, with no session barrier at all", async () => {
  const runtime = await freshRuntime("shutdown_xact_barrier")
  try {
    // No `startMaintenanceSession` here: this is the claim under test.
    assert.equal(await maintenanceWouldStart(runtime), true, "a quiet database must let maintenance start")
    const writer = await gatedWriter(runtime)
    try {
      assert.equal(
        await maintenanceWouldStart(runtime),
        false,
        "a transaction holding the SHARED key must refuse an EXCLUSIVE maintenance hold",
      )
    } finally {
      await writer.commit()
    }
    assert.equal(await maintenanceWouldStart(runtime), true, "the xact hold must go with the COMMIT")
  } finally {
    await runtime.close()
  }
})

void test("a shutdown whose drain rejects keeps the barrier until the query pool has ended, then answers 1", async () => {
  const runtime = await freshRuntime("shutdown_fail_closed")
  const session = await startMaintenanceSession(runtime.maintenance, { keepaliveMillis: 60_000 })
  const writer = await gatedWriter(runtime)
  let committed = false
  const reported: Array<string> = []
  let abandoned = 0
  try {
    assert.equal(session.held(), true, "the application must hold the barrier before the shutdown starts")
    const running = runShutdown({
      // The failure a child cannot be made to produce. Everything else is real.
      drain: () => Promise.reject(new Error("server.close failed")),
      destroyConnections: () => { /* no listener in this test; the real one cuts sockets */ },
      endQueries: () => runtime.closeQueries(),
      releaseBarrier: () => session.release(),
      closePools: () => runtime.close(),
      report: (step) => { reported.push(step) },
      abandon: () => { abandoned += 1 },
      escalateMs: 5_000,
      deadlineMs: settleMillis,
    })
    // Let the sequence reach `endQueries` and block there on the open writer.
    await new Promise((resolve) => { setTimeout(resolve, 250) })

    // The invariant, read off the live session rather than off the call order:
    // the barrier has NOT been given up while a write is still open.
    assert.equal(session.held(), true, "the barrier must still be held while a writer is open")
    assert.equal(session.state(), "held")
    // And no further writer can start, which is what makes the release safe
    // without depending on cancelling the HTTP request: `pg` refuses a client
    // from the first `end()` on.
    await assert.rejects(
      () => runtime.pool.connect(),
      /Cannot use a pool after calling end on the pool/u,
      "the query pool must refuse a new client before the barrier may go",
    )
    // Maintenance is refused throughout — by the writer's own xact hold here,
    // which is the point of claim 1 above.
    assert.equal(await maintenanceWouldStart(runtime), false)

    await writer.commit()
    committed = true
    // 1, because the drain failed. Reached only once the pool had ended.
    assert.equal(await settled(running), 1)
    assert.deepEqual(reported, ["drain"])
    assert.equal(abandoned, 0, "a sequence that settles must not abandon the process")
    assert.equal(session.held(), false, "the barrier is given up once the pool is closed")
    assert.equal(session.state(), "released")
    // Both holds are gone, so maintenance may now start.
    assert.equal(await maintenanceWouldStart(runtime), true)
  } finally {
    if (!committed) await writer.commit().catch(() => undefined)
    await session.release().catch(() => undefined)
    await runtime.close().catch(() => undefined)
  }
})
