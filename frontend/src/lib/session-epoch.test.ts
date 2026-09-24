import assert from "node:assert/strict"
import test from "node:test"

import { createSessionEpoch } from "./session-epoch.ts"

void test("a session that never opened owns nothing a 401 could report", () => {
  const epoch = createSessionEpoch()
  assert.equal(epoch.owns(epoch.value()), false)
  assert.equal(epoch.owns(0), false)
})

void test("opening a session makes the epoch a request leaves with its own", () => {
  const epoch = createSessionEpoch()
  epoch.open()
  assert.equal(epoch.owns(epoch.value()), true)
})

void test("closing a session disowns the epoch its own requests left with", () => {
  const epoch = createSessionEpoch()
  epoch.open()
  const open = epoch.value()
  epoch.close()
  assert.equal(epoch.owns(open), false)
  assert.equal(epoch.owns(epoch.value()), false)
})

void test("a closed session absorbs every further refusal instead of reopening", () => {
  const epoch = createSessionEpoch()
  epoch.open()
  epoch.close()
  // A view still mounted keeps reading and keeps being refused until the
  // redirect commits; each refusal reports the epoch it read on the way out.
  for (let refusal = 0; refusal < 3; refusal += 1) {
    epoch.close()
    assert.equal(epoch.owns(epoch.value()), false)
  }
})

void test("a new session supersedes the epoch of the one before it", () => {
  const epoch = createSessionEpoch()
  epoch.open()
  const first = epoch.value()
  epoch.open()
  const second = epoch.value()
  assert.notEqual(first, second)
  assert.equal(epoch.owns(first), false)
  assert.equal(epoch.owns(second), true)
})
