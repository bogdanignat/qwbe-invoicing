import assert from "node:assert/strict"
import test from "node:test"

import { DEFAULT_PAGE_SIZE, pageSizeFrom, readPageSize, rememberPageSize } from "./register-page-size.ts"

void test("only an offered page size is read back", () => {
  assert.equal(pageSizeFrom("50"), 50)
  assert.equal(pageSizeFrom("100"), 100)
  for (const value of [null, "", "0", "25", "200", "50.0", " 20"]) assert.equal(pageSizeFrom(value), undefined, String(value))
})

void test("without storage the default is used and remembering does not throw", () => {
  assert.equal(readPageSize(), DEFAULT_PAGE_SIZE)
  assert.doesNotThrow(() => { rememberPageSize(100) })
})

void test("a stored size is read back, a refusing storage falls back to the default", () => {
  const stored = new Map<string, string>()
  const working = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) } }
  const refusing = { getItem: () => { throw new Error("denied") }, setItem: () => { throw new Error("quota") } }
  const global = globalThis as { window?: unknown }
  try {
    global.window = { localStorage: working }
    rememberPageSize(50)
    assert.equal(readPageSize(), 50)
    global.window = { localStorage: refusing }
    assert.equal(readPageSize(), DEFAULT_PAGE_SIZE)
    assert.doesNotThrow(() => { rememberPageSize(100) })
  } finally {
    delete global.window
  }
})
