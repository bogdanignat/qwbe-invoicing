import assert from "node:assert/strict"
import test from "node:test"

import { cachedReadiness } from "./readiness.ts"

void test("serves readiness from memory within the interval and re-checks after it", () => {
  let clock = 1_000
  let checks = 0
  let ready = true
  const isReady = cachedReadiness(() => { checks += 1; return ready }, 5_000, () => clock)
  assert.equal(isReady(), true)
  assert.equal(isReady(), true)
  assert.equal(checks, 1)
  ready = false
  clock += 4_999
  assert.equal(isReady(), true)
  assert.equal(checks, 1)
  clock += 1
  assert.equal(isReady(), false)
  assert.equal(checks, 2)
  ready = true
  clock += 5_000
  assert.equal(isReady(), true)
  assert.equal(checks, 3)
})
