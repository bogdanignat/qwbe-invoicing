import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { PermissionDenied, ResourceNotFound, createPaymentsService, cube, paymentsMigrations, paymentsPermissions, type Payment, type PaymentsTransaction } from "./index.ts"

const invoice = { id: "invoice-1", organizationId: "org-1", currency: "RON", dueDate: "2026-09-15", totalIncludingTax: "100.00" }
const payments = new Map<string, Payment>()
const transaction: PaymentsTransaction = {
  findInvoiceSnapshot: (organizationId, id) => Effect.succeed(organizationId === invoice.organizationId && id === invoice.id ? invoice : undefined),
  savePayment: (payment) => Effect.sync(() => { payments.set(payment.id, payment) }),
  listPayments: (organizationId, invoiceId) => Effect.succeed([...payments.values()].filter((payment) =>
    payment.organizationId === organizationId && payment.invoiceId === invoiceId)),
}
const service = (organizationId = "org-1", permissionsList: ReadonlyArray<string> = ["payments:read", "payments:payment.record"]) =>
  createPaymentsService({
    context: { current: Effect.succeed({ identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: permissionsList }, organization: { id: organizationId } }) },
    clock: { now: Effect.succeed(new Date("2026-09-10T00:00:00.000Z")) }, ids: { next: Effect.succeed("payment-1") },
    store: { transaction: (use) => use(transaction) }, cubeIdentity: "payments",
  })

void test("publishes an authenticated payment cube", () => {
  assert.equal(cube.manifest.name, "payments")
  assert.deepEqual(cube.manifest.tables, ["invoice_payments"])
  assert.deepEqual(paymentsMigrations.map(({ name }) => name), ["002-invoice-payments"])
  assert.deepEqual(paymentsPermissions("payments"), { read: "payments:read", record: "payments:payment.record" })
})
void test("records and summarizes payments through invoice and payment ports", async () => {
  payments.clear()
  const result = await Effect.runPromise(service().recordPayment({ invoiceId: invoice.id, amount: "25.5", currency: "RON", paymentDate: "2026-09-10", method: " transfer " }))
  assert.equal(result.payment.amount, "25.50")
  assert.deepEqual(await Effect.runPromise(service().listPayments(invoice.id)), {
    invoiceId: invoice.id, status: "partially_paid", paidAmount: "25.50", remainingAmount: "74.50", payments: [result.payment],
  })
})
void test("preserves validation, permission, and tenant isolation failures", async () => {
  await assert.rejects(() => Effect.runPromise(service().recordPayment({ invoiceId: invoice.id, amount: "0", currency: "RON", paymentDate: "2026-09-10", method: "cash" })),
    /ValidationFailure/)
  assert.equal(await Effect.runPromise(Effect.flip(service("org-2").listPayments(invoice.id))) instanceof ResourceNotFound, true)
  assert.equal(await Effect.runPromise(Effect.flip(service("org-1", []).listPayments(invoice.id))) instanceof PermissionDenied, true)
})
void test("accepts legacy invoicing payment permissions during host upgrades", async () => {
  payments.clear()
  const recorded = await Effect.runPromise(service("org-1", ["invoicing:payment.record"]).recordPayment({
    invoiceId: invoice.id, amount: "10", currency: "RON", paymentDate: "2026-09-10", method: "cash",
  }))
  assert.equal(recorded.payment.amount, "10.00")
  assert.equal((await Effect.runPromise(service("org-1", ["invoicing:read"]).listPayments(invoice.id))).payments.length, 1)
})
