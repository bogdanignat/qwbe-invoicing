/**
 * The debounce behind the lookup forms, without React.
 *
 * `scheduleSettle` reports the value once `delayMs` passed without being
 * cancelled; the caller cancels it on every change, so only the last value of a
 * burst of typing is ever reported. `settledValue` is the decision a render
 * makes: the value counts only if it is the one that settled, so a wait from
 * before a change or a reset never surfaces as a request.
 */
export const scheduleSettle = <Value>(value: Value, delayMs: number, onSettle: (value: Value) => void): () => void => {
  const timer = setTimeout(() => { onSettle(value) }, delayMs)
  return () => { clearTimeout(timer) }
}

export const settledValue = <Value>(settled: Value | undefined, current: Value | undefined): Value | undefined =>
  Object.is(settled, current) ? current : undefined
