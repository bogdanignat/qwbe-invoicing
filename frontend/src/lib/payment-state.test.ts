import assert from "node:assert/strict"
import test from "node:test"

import { PAYMENT_STATUSES, type Payment, type PaymentSummary } from "./payment-models.ts"
import {
  PAYMENT_METHODS, paymentActionState, paymentInputFrom, paymentMethodLabel, paymentRows, paymentStatusLabel,
  paymentStatusTone, paymentsView, reversedPaymentIds,
} from "./payment-state.ts"

const payment = (id: string, extra: Partial<Payment> = {}): Payment => ({
  id, kind: "payment", amount: "121.00", currency: "RON", paymentDate: "2026-08-31", method: "transfer", actorId: "user-1", ...extra,
})
const summary = (status: PaymentSummary["status"], remainingAmount: string, payments: ReadonlyArray<Payment> = []): PaymentSummary => ({
  invoiceId: "invoice-1", status, paidAmount: payments.length === 0 ? "0.00" : "121.00", remainingAmount, payments,
})

void test("allows payments only while an invoice has a remaining balance", () => {
  assert.equal(paymentActionState(summary("partially_paid", "1.00", [payment("p1")])).canRecordPayment, true)
  assert.equal(paymentActionState(summary("unpaid", "0.01")).canRecordPayment, true)
  assert.equal(paymentActionState(summary("paid", "0.00", [payment("p1")])).canRecordPayment, false)
})

void test("a balance that is not a well-formed positive amount closes the form", () => {
  for (const remaining of ["-1.00", "1", "1.0", "", "abc", "1,00"]) {
    assert.equal(paymentActionState(summary("unpaid", remaining)).canRecordPayment, false, remaining)
  }
})

void test("identifies overpayment and closes the form with it", () => {
  assert.deepEqual(paymentActionState(summary("overpaid", "0.00", [payment("p1")])), { canRecordPayment: false, isOverpaid: true })
  assert.equal(paymentActionState(summary("paid", "0.00")).isOverpaid, false)
})

void test("every status has a label and a badge tone", () => {
  for (const status of PAYMENT_STATUSES) {
    assert.ok(paymentStatusLabel(status).length > 0, status)
    assert.ok(["muted", "info", "positive", "storno"].includes(paymentStatusTone(status)), status)
  }
  assert.equal(paymentStatusLabel("partially_paid"), "Plătită parțial")
  assert.equal(paymentStatusTone("paid"), "positive")
  assert.equal(paymentStatusTone("overpaid"), "storno")
  assert.equal(paymentStatusTone("overdue"), paymentStatusTone("unpaid"))
})

void test("a known method reads as its label, an unknown one as stored", () => {
  for (const method of PAYMENT_METHODS) assert.equal(paymentMethodLabel(method.value), method.label)
  assert.equal(paymentMethodLabel("crypto"), "crypto")
})

const form = (fields: Readonly<Record<string, string>>): FormData => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

void test("the request body is trimmed and carries the invoice currency", () => {
  assert.deepEqual(paymentInputFrom(form({
    amount: " 50.00 ", paymentDate: "2026-10-01 ", method: " card", externalReference: " OP 7 ", note: " avans ",
  }), "EUR"), { amount: "50.00", currency: "EUR", paymentDate: "2026-10-01", method: "card", externalReference: "OP 7", note: "avans" })
})

void test("optional fields left empty or blank are omitted, not sent as empty strings", () => {
  const input = paymentInputFrom(form({ amount: "50.00", paymentDate: "2026-10-01", method: "cash", externalReference: "   ", note: "" }), "RON")
  assert.equal("externalReference" in input, false)
  assert.equal("note" in input, false)
  assert.equal("externalReference" in paymentInputFrom(form({ amount: "1.00" }), "RON"), false)
})

void test("a required field the form did not carry reads as empty for the backend to refuse", () => {
  assert.deepEqual(paymentInputFrom(form({}), "RON"), { amount: "", currency: "RON", paymentDate: "", method: "" })
})

const reversedLedger = summary("unpaid", "121.00", [
  payment("p1", { externalReference: "OP 12", note: "Avans" }),
  payment("r1", { kind: "reversal", reversesPaymentId: "p1", paymentDate: "2026-09-01" }),
  payment("p2", { method: "cash" }),
])

void test("only payments a reversal points at are reversed", () => {
  assert.deepEqual([...reversedPaymentIds(reversedLedger)], ["p1"])
  assert.equal(reversedPaymentIds(summary("unpaid", "121.00", [payment("p1")])).size, 0)
})

void test("a row offers reversal only on a payment no reversal cancelled", () => {
  const rows = paymentRows(reversedLedger)
  assert.deepEqual(rows.map((row) => [row.id, row.canReverse, row.isReversal]), [
    ["p1", false, false], ["r1", false, true], ["p2", true, false],
  ])
  const [paid, reversal, cash] = rows
  assert.ok(paid !== undefined && reversal !== undefined && cash !== undefined)
  assert.equal(paid.amount, "121.00 RON")
  assert.equal(paid.caption, "Transfer bancar · 2026-08-31")
  assert.equal(paid.reverseLabel, "Anulează plata 121.00 RON · 2026-08-31")
  assert.equal(paid.reference, "Ref. OP 12")
  assert.equal(paid.note, "Avans")
  assert.equal(reversal.amount, "−121.00 RON")
  assert.equal(reversal.caption, "Stornare plată · 2026-09-01")
  assert.equal(cash.reference, undefined)
  assert.equal(cash.caption, "Numerar · 2026-08-31")
})

void test("the panel view formats totals in the invoice currency and keys the form on the paid amount", () => {
  const view = paymentsView(summary("partially_paid", "21.00", [payment("p1", { amount: "100.00" })]), "RON")
  assert.equal(view.paid, "121.00 RON")
  assert.equal(view.remaining, "21.00 RON")
  assert.equal(view.remainingAmount, "21.00")
  assert.equal(view.formKey, "121.00")
  assert.equal(view.statusLabel, "Plătită parțial")
  assert.equal(view.statusTone, "info")
  assert.equal(view.canRecordPayment, true)
  assert.equal(view.rows.length, 1)
})
