/**
 * Readiness, asynchronous and bounded.
 *
 * The check now opens a transaction on a remote database, so it is evaluated at
 * most once per interval, served from memory in between, and — this is the part
 * that matters under load — never evaluated twice concurrently: the in-flight
 * promise is shared, so a burst of health checks costs one query and cannot take
 * connections away from real traffic.
 *
 * Fail-closed: a check that rejects answers `false`. A database that refuses to
 * answer is not a ready application, and the rejection is swallowed here rather
 * than becoming an unhandled rejection in a request handler.
 */
export const cachedReadiness = (
  check: () => Promise<boolean>,
  intervalMs: number,
  now: () => number = Date.now,
): (() => Promise<boolean>) => {
  let value: boolean | undefined
  let checkedAt = Number.NEGATIVE_INFINITY
  let inFlight: Promise<boolean> | undefined
  return async () => {
    const at = now()
    const fresh = value !== undefined && at - checkedAt < intervalMs
    if (fresh) return value === true
    // A second caller joins the run that is already going instead of starting
    // another one. The slot is cleared only after the result has been recorded,
    // so there is no window in which two callers both see it empty.
    inFlight ??= (async () => {
      try {
        const result = await check()
        value = result
        checkedAt = now()
        return result
      } catch {
        // A failed run is NOT cached: it answers `false` — fail-closed — and the
        // next call retries instead of holding the gate shut for a whole
        // interval over one transient error.
        return false
      } finally {
        inFlight = undefined
      }
    })()
    return inFlight
  }
}

export const readinessIntervalMs = 5_000
