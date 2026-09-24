import assert from "node:assert/strict"
import test from "node:test"

import { createOperationIdempotency, operationFingerprint } from "./operation-idempotency.ts"
import { ApiFailure } from "./api-errors.ts"

const networkFailure = (): Error => new ApiFailure({ message: "Conexiunea a eșuat." })
const serverFailure = (): Error => new ApiFailure({ message: "Eroare", status: 502 })
const timeoutFailure = (): Error => new ApiFailure({ message: "Timeout", status: 408 })
const clientFailure = (): Error => new ApiFailure({ message: "Conflict", status: 409 })

void test("the same operation and fingerprint reuse one key across attempts", () => {
  let next = 0
  const idempotency = createOperationIdempotency(() => `key-${String(next += 1)}`)
  assert.equal(idempotency.current("issue-invoice", "payload-a"), "key-1")
  assert.equal(idempotency.current("issue-invoice", "payload-a"), "key-1")
})

void test("a different payload or operation gets a different key", () => {
  let next = 0
  const idempotency = createOperationIdempotency(() => `key-${String(next += 1)}`)
  const first = idempotency.current("issue-invoice", "payload-a")
  const second = idempotency.current("issue-invoice", "payload-b")
  const other = idempotency.current("issue-proforma", "payload-a")
  assert.notEqual(first, second)
  assert.notEqual(first, other)
})

void test("a network, timeout or server failure keeps the key: the answer may exist", () => {
  for (const failure of [networkFailure(), timeoutFailure(), serverFailure()]) {
    const idempotency = createOperationIdempotency(() => "key")
    idempotency.current("issue-invoice", "payload-a")
    idempotency.fail("issue-invoice", "payload-a", failure)
    assert.equal(idempotency.current("issue-invoice", "payload-a"), "key", failure.message)
  }
})

void test("a settled client error drops the key: the request never committed", () => {
  let next = 0
  const idempotency = createOperationIdempotency(() => `key-${String(next += 1)}`)
  const first = idempotency.current("issue-invoice", "payload-a")
  idempotency.fail("issue-invoice", "payload-a", clientFailure())
  assert.notEqual(idempotency.current("issue-invoice", "payload-a"), first)
})

void test("a non-API failure keeps the key", () => {
  const idempotency = createOperationIdempotency(() => "key")
  idempotency.current("issue-invoice", "payload-a")
  idempotency.fail("issue-invoice", "payload-a", new Error("unexpected"))
  assert.equal(idempotency.current("issue-invoice", "payload-a"), "key")
})

void test("complete clears every key of the operation: the next attempt is new", () => {
  let next = 0
  const idempotency = createOperationIdempotency(() => `key-${String(next += 1)}`)
  const first = idempotency.current("issue-invoice", "payload-a")
  idempotency.current("issue-invoice", "payload-b")
  idempotency.complete("issue-invoice")
  assert.notEqual(idempotency.current("issue-invoice", "payload-a"), first)
  assert.notEqual(idempotency.current("issue-invoice", "payload-b"), first)
})

void test("the fingerprint is canonical: key order does not change the intent", () => {
  assert.equal(operationFingerprint({ series: "FCT", issueDate: "2026-01-01" }),
    operationFingerprint({ issueDate: "2026-01-01", series: "FCT" }))
  assert.notEqual(operationFingerprint({ series: "FCT" }), operationFingerprint({ series: "ALT" }))
})
