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

void test("a draft creation key follows the document intent, never the attempt", () => {
  let sequence = 0
  const keys = createOperationIdempotency(() => `key-${String(++sequence)}`)
  const payload = JSON.stringify({ customerId: "customer-1", series: "QWBE", issueDate: "2026-09-01", dueDate: null, notes: null })
  const key = keys.current("create-draft", payload)
  // Retrying the save is the same intent: the key may not rotate, or the server
  // authors a second draft for one document. The authoring hook deliberately
  // never reports a create failure to `fail`, so no failure class can drop it.
  assert.equal(keys.current("create-draft", payload), key)
  for (const error of [new Error("network"), new ApiFailure({ message: "conflict", status: 409, issues: [] }),
    new ApiFailure({ message: "unreadable", status: 200, issues: [] })]) {
    assert.equal(keys.current("create-draft", payload), key, error.message)
  }
  // Editing the form is a different document, and gets its own key.
  const edited = JSON.stringify({ customerId: "customer-1", series: "QWBE", issueDate: "2026-09-02", dueDate: null, notes: null })
  assert.notEqual(keys.current("create-draft", edited), key)
  // Once the draft exists the intent is spent; the next new document starts over.
  keys.complete("create-draft")
  assert.notEqual(keys.current("create-draft", payload), key)
})
