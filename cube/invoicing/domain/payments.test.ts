import assert from "node:assert/strict"
import test from "node:test"
import { ValidationFailure } from "../contracts/failures.ts"
import { derivePaymentStatus, validateRecordPaymentInput, formatMinor, sumPaymentsMinor } from "./payments.ts"
void test("validates payment input and derives statuses", () => {
  assert.throws(() => { validateRecordPaymentInput({ invoiceId: "", amount: "10.00", currency: "RON", paymentDate: "2026-09-10", method: "transfer" }) }, (e) => e instanceof ValidationFailure)
  assert.throws(() => { validateRecordPaymentInput({ invoiceId: "inv-1", amount: "0.00", currency: "RON", paymentDate: "2026-09-10", method: "transfer" }) }, (e) => e instanceof ValidationFailure)
  assert.throws(() => { validateRecordPaymentInput({ invoiceId: "inv-1", amount: "10.00", currency: "RON", paymentDate: "2026-13-01", method: "transfer" }) }, (e) => e instanceof ValidationFailure)
  validateRecordPaymentInput({ invoiceId: "inv-1", amount: "10.00", currency: "RON", paymentDate: "2026-09-10", method: "transfer" })
  const base = { totalIncludingTax: "100.00", dueDate: "2026-09-15", now: new Date("2026-09-10T00:00:00.000Z") } as const
  assert.equal(derivePaymentStatus({ ...base, payments: [] }), "unpaid")
  assert.equal(derivePaymentStatus({ ...base, payments: [{ id: "p1", invoiceId: "inv-1", organizationId: "org-1", amount: "30.00", currency: "RON", paymentDate: "2026-09-10", method: "transfer", actorId: "u1", createdAt: "2026-09-10T00:00:00.000Z" }] }), "partially_paid")
  assert.equal(derivePaymentStatus({ ...base, payments: [{ id: "p1", invoiceId: "inv-1", organizationId: "org-1", amount: "100.00", currency: "RON", paymentDate: "2026-09-10", method: "transfer", actorId: "u1", createdAt: "2026-09-10T00:00:00.000Z" }] }), "paid")
  assert.equal(derivePaymentStatus({ ...base, payments: [{ id: "p1", invoiceId: "inv-1", organizationId: "org-1", amount: "120.00", currency: "RON", paymentDate: "2026-09-10", method: "transfer", actorId: "u1", createdAt: "2026-09-10T00:00:00.000Z" }] }), "overpaid")
  assert.equal(derivePaymentStatus({ totalIncludingTax: "100.00", dueDate: "2026-09-01", payments: [], now: new Date("2026-09-10T00:00:00.000Z") }), "overdue")
  assert.equal(derivePaymentStatus({ totalIncludingTax: "100.00", dueDate: "2026-09-01", payments: [{ id: "p1", invoiceId: "inv-1", organizationId: "org-1", amount: "30.00", currency: "RON", paymentDate: "2026-09-05", method: "transfer", actorId: "u1", createdAt: "2026-09-05T00:00:00.000Z" }], now: new Date("2026-09-10T00:00:00.000Z") }), "overdue")
  assert.equal(derivePaymentStatus({ totalIncludingTax: "100.00", dueDate: null, payments: [], now: new Date("2026-09-10T00:00:00.000Z") }), "unpaid")
  assert.equal(formatMinor(12345n), "123.45")
  assert.equal(sumPaymentsMinor([{ id: "p1", invoiceId: "inv-1", organizationId: "org-1", amount: "10.00", currency: "RON", paymentDate: "2026-09-10", method: "transfer", actorId: "u1", createdAt: "2026-09-10T00:00:00.000Z" }, { id: "p2", invoiceId: "inv-1", organizationId: "org-1", amount: "5.50", currency: "RON", paymentDate: "2026-09-10", method: "transfer", actorId: "u1", createdAt: "2026-09-10T00:01:00.000Z" }]), 1550n)
})
