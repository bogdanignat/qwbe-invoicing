import assert from "node:assert/strict"
import test from "node:test"

import { ApiFailure } from "../lib/api.ts"
import { createOperationIdempotency } from "./operation-idempotency.ts"

void test("keeps idempotency keys stable per action and payload and invalidates HTTP failures", () => {
  let sequence = 0
  const keys = createOperationIdempotency(() => `key-${String(++sequence)}`)
  assert.equal(keys.current("invoice", "INV"), "key-1")
  assert.equal(keys.current("invoice", "INV"), "key-1")
  assert.equal(keys.current("invoice", "WEB"), "key-2")
  assert.equal(keys.current("invoice", "INV"), "key-1")
  assert.equal(keys.current("draft", "INV"), "key-3")
  keys.fail("invoice", "INV", new Error("network"))
  assert.equal(keys.current("invoice", "INV"), "key-1")
  keys.fail("invoice", "INV", new ApiFailure({ message: "conflict", status: 409, issues: [] }))
  assert.equal(keys.current("invoice", "INV"), "key-4")
  keys.complete("invoice")
  assert.equal(keys.current("invoice", "WEB"), "key-5")
  assert.equal(keys.current("draft", "INV"), "key-3")
})

void test("preserves the same key when a timeout or server failure leaves the commit outcome uncertain", () => {
  for (const status of [408, 500, 502, 503, 504]) {
    let sequence = 0
    const keys = createOperationIdempotency(() => `key-${String(++sequence)}`)
    const original = keys.current("create-proforma", "payload")
    keys.fail("create-proforma", "payload", new ApiFailure({ message: "uncertain response", status, issues: [] }))
    assert.equal(keys.current("create-proforma", "payload"), original, `HTTP ${String(status)}`)
  }
})
