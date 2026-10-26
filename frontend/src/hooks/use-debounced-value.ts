import { useEffect, useState } from "react"

import { scheduleSettle } from "../lib/settle.ts"

/**
 * The value once it has stood still for `delayMs`; until then, the last value
 * that did. Unlike `useSettledValue` it never reads `undefined` while typing,
 * so a query keyed on it keeps its last answer instead of going blank.
 */
export const useDebouncedValue = <Value>(value: Value, delayMs: number): Value => {
  const [settled, setSettled] = useState(value)
  useEffect(() => scheduleSettle(value, delayMs, (next: Value) => { setSettled(() => next) }), [value, delayMs])
  return settled
}
