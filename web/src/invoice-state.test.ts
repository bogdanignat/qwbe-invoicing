import assert from "node:assert/strict"
import test from "node:test"

import { invoiceActionState } from "./invoice-state.ts"
import type { CorrectionDocument, PaymentSummary } from "./models.ts"

const summary = (status: PaymentSummary["status"], remainingAmount: string, withPayment: boolean): PaymentSummary => ({
  invoiceId: "invoice-1", status, paidAmount: withPayment ? "121.00" : "0.00", remainingAmount,
  payments: withPayment ? [{ id: "payment-1", amount: "121.00", currency: "RON", paymentDate: "2026-08-31", method: "transfer" }] : [],
})
const correction: CorrectionDocument = { id: "correction-1", series: "QWBE", number: 1, issueDate: "2026-08-31", reason: "Corecție", currency: "RON", totalIncludingTax: "-121.00" }

void test("allows payments only while an invoice has a remaining balance", () => {
  assert.equal(invoiceActionState(summary("partially_paid", "1.00", true), []).canRecordPayment, true)
  assert.equal(invoiceActionState(summary("paid", "0.00", true), []).canRecordPayment, false)
})

void test("allows only one full correction and identifies overpayment", () => {
  assert.deepEqual(invoiceActionState(summary("overpaid", "0.00", true), [correction]), {
    canRecordPayment: false,
    canCreateFullCorrection: false,
    isOverpaid: true,
  })
})
