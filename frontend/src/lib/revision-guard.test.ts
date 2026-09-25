import assert from "node:assert/strict"
import test from "node:test"

import { createRevisionGuard } from "./revision-guard.ts"

void test("revision guard — keeps a revision current until something changes", () => {
  const guard = createRevisionGuard()
  const revision = guard.current()
  assert.equal(guard.isCurrent(revision), true)
  guard.invalidate()
  assert.equal(guard.isCurrent(revision), false)
})

void test("revision guard — supersedes an older selection", () => {
  const guard = createRevisionGuard()
  const first = guard.begin()
  const second = guard.begin()
  assert.notEqual(first, second)
  assert.equal(guard.isCurrent(first), false)
  assert.equal(guard.isCurrent(second), true)
})

void test("revision guard — reads the current revision without moving it", () => {
  const guard = createRevisionGuard()
  assert.equal(guard.current(), guard.current())
  assert.equal(guard.isCurrent(guard.current()), true)
})
