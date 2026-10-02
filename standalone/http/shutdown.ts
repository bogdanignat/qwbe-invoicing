/**
 * The shutdown sequence of `serve`, as a function instead of a promise chain.
 *
 * It is its own module because nothing that matters about it could be tested
 * inside the signal handler: a drain that rejects, a release that rejects and a
 * drain that never settles are all failures of the real process, and the only
 * way to reach them from a test was to produce them in a child. Every step is a
 * parameter, so a test drives the failures directly while production passes the
 * real server, the real barrier and the real pools. No test-only branch and no
 * environment variable reaches production from here.
 *
 * Three rules, all load-bearing:
 *
 * 1. The barrier is given up only once this process can no longer open a
 *    transaction. That is what `endQueries` proves and what nothing else on this
 *    path can: destroying a socket does NOT cancel the request behind it — the
 *    handler's fiber is detached and its `Request` carries no `signal` — so an
 *    in-flight write survives both `server.close` and
 *    `closeAllConnections()`. Ending the query pool is the one step that waits
 *    for the writes themselves (`pg` resolves `end()` only when every
 *    checked-out client is back) and then refuses to hand out another, so from
 *    that moment no `pg_advisory_xact_lock_shared` can be taken on the barrier
 *    this process is about to release.
 * 2. Every step is attempted even after an earlier one failed, with one
 *    exception: a failed `endQueries` leaves it unknown whether a writer is
 *    still live, so the barrier is NOT released and the process is abandoned
 *    instead. A released barrier cannot be taken back; a barrier held by a dead
 *    process is released by the server with the session.
 * 3. A failed step is reported and kept in the exit code: 1 if anything failed,
 *    0 only when every step finished. A drain that had to be forced counts as
 *    failed even when `server.close` resolved afterwards.
 *
 * A drain that never settles (a client that never finishes its body, a slow
 * response) is escalated at `escalateMs`: the sockets are destroyed, which lets
 * `server.close` resolve, and the sequence carries on to `endQueries`, which
 * still waits for the writes behind those sockets. Without it such a drain sat
 * idle until the deadline abandoned the process.
 */
export interface ShutdownSteps {
  /** Drains the listener and disposes the API handler. */
  readonly drain: () => Promise<void>
  /**
   * Destroys whatever is still connected. Only ever after a drain that failed or
   * did not finish within `escalateMs`, at most once, and only to stop the
   * socket: it does not end the work behind it, so it is best effort and never
   * the reason the barrier may go.
   */
  readonly destroyConnections: () => void
  /**
   * Ends the query pool alone — not the maintenance pool, whose one client is
   * checked out for as long as the barrier is held, so ending it here would
   * never resolve. This is the step the release waits behind.
   */
  readonly endQueries: () => Promise<void>
  readonly releaseBarrier: () => Promise<void>
  readonly closePools: () => Promise<void>
  /** Why a step failed. Redaction belongs to the caller, which owns the secret. */
  readonly report: (step: string, error: unknown) => void
  /**
   * The bounded end, called once when the sequence cannot finish safely: the
   * deadline passed, or `endQueries` failed and continuing would mean releasing
   * the barrier on an unknown state. In production it is `process.exit(1)`: the
   * maintenance pool holds a checked-out client with `idleTimeoutMillis: 0`, so
   * the event loop never drains on its own and a process that merely stops
   * serving is killed by the orchestrator with SIGKILL (137) instead of
   * reporting a status.
   */
  readonly abandon: () => void
  /** When a drain still running is forced. Must be below `deadlineMs`. */
  readonly escalateMs: number
  readonly deadlineMs: number
}

/** 0 when every step finished, 1 when any of them failed. */
export const runShutdown = async (steps: ShutdownSteps): Promise<number> => {
  const deadline = setTimeout(() => { steps.abandon() }, steps.deadlineMs)
  // Unref'd: a loop that empties while the release is still pending exits on its
  // own instead of waiting out the deadline.
  deadline.unref()
  // An object, not a `let`: every write is inside a callback, which control-flow
  // analysis does not follow, so a plain boolean reads as always `false`.
  const outcome = { failed: false }
  const attempt = async (name: string, step: () => Promise<void>): Promise<boolean> => {
    try {
      await step()
      return true
    } catch (error) {
      outcome.failed = true
      steps.report(name, error)
      return false
    }
  }
  let destroyed = false
  const destroy = () => {
    if (destroyed) return
    destroyed = true
    try {
      steps.destroyConnections()
    } catch (error) {
      outcome.failed = true
      steps.report("destroy", error)
    }
  }
  const escalation = setTimeout(() => {
    outcome.failed = true
    steps.report("drain", new Error(`still draining after ${String(steps.escalateMs)}ms, destroying connections`))
    destroy()
  }, steps.escalateMs)
  escalation.unref()
  const drained = await attempt("drain", steps.drain)
  clearTimeout(escalation)
  if (!drained) destroy()
  if (!await attempt("queries", steps.endQueries)) {
    // Fail closed. The barrier stays held and dies with the process, which is
    // the only outcome that cannot let `migrate`/`backup`/`restore` start next
    // to a writer this process may still have open.
    steps.report("barrier", new Error("kept: the query pool did not end, so the barrier dies with the process"))
    clearTimeout(deadline)
    steps.abandon()
    return 1
  }
  await attempt("barrier", steps.releaseBarrier)
  await attempt("pools", steps.closePools)
  clearTimeout(deadline)
  return outcome.failed ? 1 : 0
}
