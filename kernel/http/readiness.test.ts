import assert from "node:assert/strict"
import test from "node:test"

import { cachedReadiness } from "./readiness.ts"

/**
 * The check is asynchronous now, so the test awaits it — and two properties the
 * SQLite version could not express are asserted here, because they only exist
 * once the check is a promise: concurrent callers share one run, and a rejected
 * check answers `false` instead of escaping as an unhandled rejection.
 */
void test("serves readiness from memory within the interval and re-checks after it", async () => {
  let clock = 1_000
  let checks = 0
  let ready = true
  let fail = false
  const isReady = cachedReadiness(() => {
    checks += 1
    return fail ? Promise.reject(new Error("the database refused to answer")) : Promise.resolve(ready)
  }, 5_000, () => clock)
  assert.equal(await isReady(), true)
  assert.equal(await isReady(), true)
  assert.equal(checks, 1)
  ready = false
  clock += 4_999
  assert.equal(await isReady(), true)
  assert.equal(checks, 1)
  clock += 1
  assert.equal(await isReady(), false)
  assert.equal(checks, 2)
  ready = true
  clock += 5_000
  assert.equal(await isReady(), true)
  assert.equal(checks, 3)

  // A burst costs one check: the in-flight promise is shared.
  clock += 5_000
  assert.deepEqual(await Promise.all([isReady(), isReady(), isReady()]), [true, true, true])
  assert.equal(checks, 4)

  // Fail-closed, and retried on the next call rather than pinned shut.
  clock += 5_000
  fail = true
  assert.equal(await isReady(), false)
  assert.equal(checks, 5)
  fail = false
  clock += 5_000
  assert.equal(await isReady(), true)
  assert.equal(checks, 6)
})
