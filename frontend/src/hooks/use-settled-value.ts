"use client"

import { useEffect, useState } from "react"

import { scheduleSettle, settledValue } from "../lib/settle.ts"

/**
 * The value once it has stood still for `delayMs`, `undefined` until then.
 * Every change cancels the pending wait and starts a new one (`lib/settle.ts`).
 */
export const useSettledValue = <Value>(value: Value | undefined, delayMs: number): Value | undefined => {
  const [settled, setSettled] = useState<Value | undefined>(undefined)
  useEffect(() => scheduleSettle(value, delayMs, setSettled), [value, delayMs])
  return settledValue(settled, value)
}
