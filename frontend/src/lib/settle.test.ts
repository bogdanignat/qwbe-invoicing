import assert from "node:assert/strict"
import test, { mock } from "node:test"

import { LOOKUP_DEBOUNCE_MS } from "./company-lookup-query.ts"
import { scheduleSettle, settledValue } from "./settle.ts"

void test("a value settles only after the full wait", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  try {
    const settled: Array<string> = []
    scheduleSettle("13548146", LOOKUP_DEBOUNCE_MS, (value) => { settled.push(value) })
    mock.timers.tick(LOOKUP_DEBOUNCE_MS - 1)
    assert.deepEqual(settled, [])
    mock.timers.tick(1)
    assert.deepEqual(settled, ["13548146"])
  } finally {
    mock.timers.reset()
  }
})

void test("typing cancels the pending wait at every key: only the last value of a burst settles", () => {
  mock.timers.enable({ apis: ["setTimeout"] })
  try {
    const settled: Array<string> = []
    let cancel: () => void = () => undefined
    for (const value of ["1", "13", "135", "1354", "13548146"]) {
      cancel()
      cancel = scheduleSettle(value, LOOKUP_DEBOUNCE_MS, (done) => { settled.push(done) })
      mock.timers.tick(200)
    }
    mock.timers.tick(LOOKUP_DEBOUNCE_MS)
    assert.deepEqual(settled, ["13548146"])
    const stop = scheduleSettle("dropped", LOOKUP_DEBOUNCE_MS, (done) => { settled.push(done) })
    stop()
    mock.timers.tick(LOOKUP_DEBOUNCE_MS * 2)
    assert.deepEqual(settled, ["13548146"], "a cancelled wait never reports")
  } finally {
    mock.timers.reset()
  }
})

void test("a render counts the value only if it is the one that settled", () => {
  assert.equal(settledValue("13548146", "13548146"), "13548146")
  assert.equal(settledValue("13548146", "1354814"), undefined, "changed since: wait again")
  assert.equal(settledValue("13548146", undefined), undefined, "reset: nothing")
  assert.equal(settledValue(undefined, "13548146"), undefined, "not settled yet")
})
