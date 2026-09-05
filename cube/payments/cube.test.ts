import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict, PermissionDenied, ResourceNotFound, createPaymentsService, cube, paymentsMigrations, paymentsPermissions, type Payment, type PaymentIdempotencyRecord, type PaymentsTransaction } from "./index.ts"

const invoice = { id: "invoice-1", organizationId: "org-1", currency: "RON", dueDate: "2026-09-15", totalIncludingVat: "100.00" }
const payments = new Map<string, Payment>()
const records = new Map<string, PaymentIdempotencyRecord>()
const transaction: PaymentsTransaction = {
  findInvoiceSnapshot: (organizationId, id) => Effect.succeed(organizationId === invoice.organizationId && id === invoice.id ? invoice : undefined),
  savePayment: (payment) => Effect.sync(() => { payments.set(payment.id, payment) }),
  listPayments: (organizationId, invoiceId) => Effect.succeed([...payments.values()].filter((payment) =>
    payment.organizationId === organizationId && payment.invoiceId === invoiceId)),
  findPayment: (organizationId, invoiceId, paymentId) => Effect.succeed([...payments.values()].find((payment) =>
    payment.organizationId === organizationId && payment.invoiceId === invoiceId && payment.id === paymentId)),
  findIdempotencyRecord: (organizationId, key) => Effect.succeed(records.get(`${organizationId}:${key}`)),
  saveIdempotencyRecord: (record) => Effect.sync(() => { records.set(`${record.organizationId}:${record.key}`, record) }),
}
let keyCounter = 0
const idempotent = <Input>(request: Input, key = `key-${String(++keyCounter)}`) => ({ request, idempotency: { key, fingerprint: `sha256:${"0".repeat(64)}` } })
const reset = () => { payments.clear(); records.clear() }
const service = (organizationId = "org-1", permissionsList: ReadonlyArray<string> = ["payments:read", "payments:payment.record"], ids = ["payment-1"]) => {
  let next = 0
  return createPaymentsService({
    context: { current: Effect.succeed({ identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: permissionsList }, organization: { id: organizationId } }) },
    clock: { now: Effect.succeed(new Date("2026-09-10T00:00:00.000Z")) }, ids: { next: Effect.sync(() => ids[next++] ?? `payment-${String(next)}`) },
    store: { transaction: (use) => use(transaction) }, cubeIdentity: "payments",
  })
}

void test("publishes an authenticated payment cube", () => {
  assert.equal(cube.manifest.name, "payments")
  assert.deepEqual(cube.manifest.tables, ["invoice_payments"])
  assert.deepEqual(paymentsMigrations.map(({ name }) => name), ["002-invoice-payments", "012-payment-idempotency"])
  assert.deepEqual(paymentsPermissions("payments"), { read: "payments:read", record: "payments:payment.record" })
})
void test("records and summarizes payments through invoice and payment ports", async () => {
  reset()
  const attempt = idempotent({ invoiceId: invoice.id, amount: "25.5", currency: "RON", paymentDate: "2026-09-10", method: " transfer " })
  const result = await Effect.runPromise(service().recordPayment(attempt))
  assert.equal(result.payment.amount, "25.50")
  assert.equal(result.payment.kind, "payment")
  assert.deepEqual(await Effect.runPromise(service().listPayments(invoice.id)), {
    invoiceId: invoice.id, status: "partially_paid", paidAmount: "25.50", remainingAmount: "74.50", payments: [result.payment],
  })
  const replay = await Effect.runPromise(service("org-1", undefined, ["payment-9"]).recordPayment(attempt))
  assert.deepEqual(replay, result)
  assert.equal(payments.size, 1)
  const reused = await Effect.runPromise(Effect.flip(service().recordPayment({ ...attempt, request: { ...attempt.request, amount: "1" }, idempotency: { ...attempt.idempotency, fingerprint: `sha256:${"1".repeat(64)}` } })))
  assert.equal(reused instanceof DomainConflict && reused.code === "idempotency_key_reused", true)
})
void test("reverses a payment exactly once with an immutable counter-row", async () => {
  reset()
  const recorded = await Effect.runPromise(service().recordPayment(idempotent({ invoiceId: invoice.id, amount: "40", currency: "RON", paymentDate: "2026-09-10", method: "card" })))
  const reversal = await Effect.runPromise(service("org-1", undefined, ["reversal-1"]).reversePayment(idempotent({ invoiceId: invoice.id, paymentId: recorded.payment.id, reason: "Sumă greșită" })))
  assert.equal(reversal.payment.kind, "reversal")
  assert.equal(reversal.payment.reversesPaymentId, recorded.payment.id)
  assert.equal(reversal.payment.amount, "40.00")
  assert.equal(reversal.payment.note, "Sumă greșită")
  assert.deepEqual([reversal.status, reversal.paidAmount, reversal.remainingAmount], ["unpaid", "0.00", "100.00"])
  const twice = await Effect.runPromise(Effect.flip(service("org-1", undefined, ["reversal-2"]).reversePayment(idempotent({ invoiceId: invoice.id, paymentId: recorded.payment.id }))))
  assert.equal(twice instanceof DomainConflict && twice.code === "payment_already_reversed", true)
  const ofReversal = await Effect.runPromise(Effect.flip(service("org-1", undefined, ["reversal-3"]).reversePayment(idempotent({ invoiceId: invoice.id, paymentId: reversal.payment.id }))))
  assert.equal(ofReversal instanceof ResourceNotFound, true)
})
void test("preserves validation, permission, and tenant isolation failures", async () => {
  await assert.rejects(() => Effect.runPromise(service().recordPayment(idempotent({ invoiceId: invoice.id, amount: "0", currency: "RON", paymentDate: "2026-09-10", method: "cash" }))),
    /ValidationFailure/)
  assert.equal(await Effect.runPromise(Effect.flip(service("org-2").listPayments(invoice.id))) instanceof ResourceNotFound, true)
  assert.equal(await Effect.runPromise(Effect.flip(service("org-1", []).listPayments(invoice.id))) instanceof PermissionDenied, true)
})
void test("accepts legacy invoicing payment permissions during host upgrades", async () => {
  reset()
  const recorded = await Effect.runPromise(service("org-1", ["invoicing:payment.record"]).recordPayment(idempotent({
    invoiceId: invoice.id, amount: "10", currency: "RON", paymentDate: "2026-09-10", method: "cash",
  })))
  assert.equal(recorded.payment.amount, "10.00")
  assert.equal((await Effect.runPromise(service("org-1", ["invoicing:read"]).listPayments(invoice.id))).payments.length, 1)
})
