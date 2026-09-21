// Readiness is evaluated at most once per interval and served from memory in between, so
// request handling never pays for opening the databases and the health check cannot
// contend with real transactions.
export const cachedReadiness = (
  check: () => boolean,
  intervalMs: number,
  now: () => number = Date.now,
): (() => boolean) => {
  let value: boolean | undefined
  let checkedAt = Number.NEGATIVE_INFINITY
  return () => {
    const at = now()
    if (value === undefined || at - checkedAt >= intervalMs) {
      value = check()
      checkedAt = at
    }
    return value
  }
}

export const readinessIntervalMs = 5_000
