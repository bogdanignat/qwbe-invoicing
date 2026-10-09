import assert from "node:assert/strict"
import test from "node:test"

import { decodePaymentSummary } from "./payment-decoders.ts"
import { PAYMENT_STATUSES } from "./payment-models.ts"

/** What `PaymentSummary` answers (standalone/api/schema-payments.ts), server-only fields included. */
const payment = {
  id: "pay-1", invoiceId: "inv-1", organizationId: "org-1", kind: "payment",
  amount: "100.00", currency: "RON", paymentDate: "2026-10-01", method: "transfer",
  externalReference: "OP 12", note: "Avans", actorId: "user-1", createdAt: "2026-10-01T08:00:00.000Z",
}
const reversal = {
  id: "pay-2", invoiceId: "inv-1", organizationId: "org-1", kind: "reversal", reversesPaymentId: "pay-1",
  amount: "100.00", currency: "RON", paymentDate: "2026-10-02", method: "transfer",
  actorId: "user-1", createdAt: "2026-10-02T08:00:00.000Z",
}
const summary = {
  invoiceId: "inv-1", status: "partially_paid", paidAmount: "100.00", remainingAmount: "21.00", payments: [payment, reversal],
}

void test("a summary decodes with its payments and reversals", () => {
  const decoded = decodePaymentSummary(summary)
  assert.equal(decoded.status, "partially_paid")
  assert.equal(decoded.remainingAmount, "21.00")
  assert.deepEqual(decoded.payments.map((entry) => entry.kind), ["payment", "reversal"])
  const [first, second] = decoded.payments
  assert.ok(first !== undefined && second !== undefined)
  assert.equal(first.externalReference, "OP 12")
  assert.equal(first.note, "Avans")
  assert.equal(second.reversesPaymentId, "pay-1")
  // Fields the screen never renders are not carried into the model.
  assert.equal("organizationId" in first, false)
  assert.equal("createdAt" in first, false)
})

void test("an absent or null optional field is omitted, not kept as undefined or null", () => {
  const decoded = decodePaymentSummary({ ...summary, payments: [{ ...payment, externalReference: null, note: undefined }] })
  const [entry] = decoded.payments
  assert.ok(entry !== undefined)
  assert.equal("externalReference" in entry, false)
  assert.equal("note" in entry, false)
  assert.equal("reversesPaymentId" in entry, false)
})

void test("every status the backend declares is accepted", () => {
  for (const status of PAYMENT_STATUSES) {
    assert.equal(decodePaymentSummary({ ...summary, status }).status, status)
  }
})

void test("an unknown status is refused at the boundary", () => {
  assert.throws(() => decodePaymentSummary({ ...summary, status: "refunded" }), /invalid status/u)
  assert.throws(() => decodePaymentSummary({ ...summary, status: 1 }), /invalid status/u)
})

void test("an unknown payment kind is refused, not rendered as a payment", () => {
  assert.throws(() => decodePaymentSummary({ ...summary, payments: [{ ...payment, kind: "refund" }] }), /invalid kind/u)
})

void test("a missing amount or a non-array ledger fails at the boundary", () => {
  assert.throws(() => decodePaymentSummary({ ...summary, payments: [{ ...payment, amount: undefined }] }), /invalid amount/u)
  assert.throws(() => decodePaymentSummary({ ...summary, payments: null }), /invalid payments/u)
  assert.throws(() => decodePaymentSummary([summary]), /expected object/u)
})
