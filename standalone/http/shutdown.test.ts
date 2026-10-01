import assert from "node:assert/strict"
import test from "node:test"

import { runShutdown, type ShutdownSteps } from "./shutdown.ts"

/**
 * The SIGTERM path of `serve`, including the failures no existing test could
 * reach: a drain that rejects, a query pool that will not end, and a step that
 * never settles.
 *
 * `postgres-cli-lifecycle.test.ts` spawns the real CLI and exercises a drain
 * that succeeds; neither a rejecting `server.close(error)` nor a hung socket can
 * be produced from outside the process. The steps are parameters here, so the
 * failures are injected directly — no environment variable, no test-only branch
 * in production code, and the production wiring in `bin/qwbe-invoicing.ts` is
 * the same function with the real server, barrier and pools.
 *
 * The ORDER these cases pin is the safety property, and
 * `shutdown-barrier.test.ts` measures the same order against a real PostgreSQL
 * server: `queries` before `barrier`, always, because ending the query pool is
 * the only step that waits for an in-flight write and then refuses the next
 * client.
 */

interface Recorder {
  readonly order: ReadonlyArray<string>
  readonly failures: ReadonlyArray<string>
  readonly abandoned: () => number
}

/**
 * The injected sequence. An override may be a function of the recorded order, so
 * a failing or hanging step can still record that it ran.
 */
type Overrides = Partial<ShutdownSteps> | ((order: Array<string>) => Partial<ShutdownSteps>)

const steps = (overrides: Overrides = {}): ShutdownSteps & Recorder => {
  const order: Array<string> = []
  const failures: Array<string> = []
  let abandoned = 0
  return {
    order,
    failures,
    abandoned: () => abandoned,
    drain: () => { order.push("drain"); return Promise.resolve() },
    destroyConnections: () => { order.push("destroy") },
    endQueries: () => { order.push("queries"); return Promise.resolve() },
    releaseBarrier: () => { order.push("barrier"); return Promise.resolve() },
    closePools: () => { order.push("pools"); return Promise.resolve() },
    report: (step) => { failures.push(step) },
    abandon: () => { abandoned += 1 },
    deadlineMs: 10_000,
    ...(typeof overrides === "function" ? overrides(order) : overrides),
  }
}

void test("a clean shutdown drains, ends the queries, releases the barrier, closes and answers 0", async () => {
  const recorded = steps()
  assert.equal(await runShutdown(recorded), 0)
  // The order is the invariant: the barrier may not be given up before the query
  // pool has ended, because that is the step that waits for in-flight writes.
  assert.deepEqual(recorded.order, ["drain", "queries", "barrier", "pools"])
  assert.deepEqual(recorded.failures, [])
  assert.equal(recorded.abandoned(), 0)
})

void test("a drain that rejects destroys the sockets, still ends the queries before the barrier, and answers 1", async () => {
  const recorded = steps({ drain: () => Promise.reject(new Error("server.close failed")) })
  // 1, not 0: a shutdown that could not drain is a failed shutdown, and anything
  // keyed on the exit status has to see that.
  assert.equal(await runShutdown(recorded), 1)
  // `destroy` is best effort — it stops the socket, not the request behind it,
  // whose fiber is detached and carries no abort signal. What makes the release
  // safe on this path is `queries`, which still comes first. Then every
  // remaining step runs anyway: a barrier left held or a pool left open is the
  // hang this process was fixed for.
  assert.deepEqual(recorded.order, ["destroy", "queries", "barrier", "pools"])
  assert.deepEqual(recorded.failures, ["drain"])
  assert.equal(recorded.abandoned(), 0)
})

void test("a query pool that will not end keeps the barrier, abandons the process and answers 1", async () => {
  const recorded = steps((order) => ({
    endQueries: () => { order.push("queries"); return Promise.reject(new Error("pool end failed")) },
  }))
  assert.equal(await runShutdown(recorded), 1)
  // Fail closed: with the query pool in an unknown state a writer of this
  // process may still be live, so the barrier is NOT released — it dies with the
  // process, which the server does for us. `pools` is skipped too: ending the
  // maintenance pool while its client is still checked out never resolves.
  assert.deepEqual(recorded.order, ["drain", "queries"])
  assert.deepEqual(recorded.failures, ["queries", "barrier"])
  // Bounded for real, and not by the deadline: the process is abandoned at once
  // (`process.exit(1)` in production) rather than waiting out 10 s to do it.
  assert.equal(recorded.abandoned(), 1)
})

void test("a release that rejects does not stop the pools, and a pool failure is kept in the code", async () => {
  const released = steps({ releaseBarrier: () => Promise.reject(new Error("barrier gone")) })
  assert.equal(await runShutdown(released), 1)
  assert.deepEqual(released.order, ["drain", "queries", "pools"])
  assert.deepEqual(released.failures, ["barrier"])

  const pooled = steps({ closePools: () => Promise.reject(new Error("pool end failed")) })
  assert.equal(await runShutdown(pooled), 1)
  assert.deepEqual(pooled.order, ["drain", "queries", "barrier"])
  assert.deepEqual(pooled.failures, ["pools"])
})

void test("a drain that never settles is abandoned at the deadline, with the barrier still held", async () => {
  let abandoned: (() => void) | undefined
  const reached = new Promise<void>((resolve) => { abandoned = resolve })
  const recorded = steps({
    // The hang itself: a socket that never closes. The promise is left pending
    // on purpose — that is the state the deadline exists for.
    drain: () => new Promise<void>(() => {}),
    deadlineMs: 50,
    abandon: () => { abandoned?.() },
  })
  const running = runShutdown(recorded)
  await reached
  // The process ends here in production (`process.exit(1)`); the sequence itself
  // is still waiting on the drain, so the barrier was never released on a
  // half-drained server — the session lock dies with the process instead.
  assert.deepEqual(recorded.order, [])
  // And the sequence is still pending rather than having resolved a status.
  const outcome = await Promise.race([running, Promise.resolve("pending")])
  assert.equal(outcome, "pending")
})

void test("a query pool that never ends is abandoned at the deadline, with the barrier still held", async () => {
  let abandoned: (() => void) | undefined
  const reached = new Promise<void>((resolve) => { abandoned = resolve })
  const recorded = steps((order) => ({
    // The production shape of this: a request that will not give its client
    // back, so `pool.end()` never resolves. It is the one hang that must not
    // turn into a release.
    endQueries: () => { order.push("queries"); return new Promise<void>(() => {}) },
    deadlineMs: 50,
    abandon: () => { abandoned?.() },
  }))
  const running = runShutdown(recorded)
  await reached
  assert.deepEqual(recorded.order, ["drain", "queries"])
  assert.deepEqual(recorded.failures, [])
  const outcome = await Promise.race([running, Promise.resolve("pending")])
  assert.equal(outcome, "pending")
})
