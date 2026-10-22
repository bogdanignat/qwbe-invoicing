import assert from "node:assert/strict"
import test from "node:test"

import { allPlugins } from "../plugins.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { issueInvoice, ok, payment, seed, serve, type Served } from "./plugins-http.test-support.ts"

/** Invalid payment input answers 400 with the shared validation envelope and writes nothing (T-1974). */
const valid = { amount: "10.00", currency: "RON", paymentDate: payment.paymentDate, method: "bank_transfer" }
const invalidPayments: ReadonlyArray<readonly [Record<string, string>, string]> = [
  [{ amount: "0.00" }, "amount must be greater than zero"],
  [{ amount: "-5.00" }, "amount must be a non-negative amount with at most two decimals"],
  [{ amount: "abc" }, "amount must be a non-negative amount with at most two decimals"],
  [{ method: " " }, "method is required"],
  [{ paymentDate: "2026-13-01" }, "paymentDate must be a valid calendar date"],
  [{ currency: "ron" }, "currency must be an ISO 4217 code"],
]
const invalidReasons: ReadonlyArray<readonly [string, string]> = [
  ["   ", "reason must not be empty when provided"],
  ["x".repeat(501), "reason must be at most 500 characters"],
]

const ledgerSize = async (call: Served["call"], invoiceId: string): Promise<number> =>
  ((await ok(call("GET", `/api/invoices/${invoiceId}/payments`), "payments")).payments as ReadonlyArray<unknown>).length

void test("invalid payments and reversals answer 400 ValidationFailure and write nothing", async () => {
  await withMigrated("payment_validation_http", async (fixture) => {
    const served = await serve(fixture, allPlugins)
    const { call } = served
    try {
      await seed(served)
      const invoiceId = String((await issueInvoice(call, "issue-1")).id)
      for (const [index, [change, issue]] of invalidPayments.entries()) {
        const reply = await call("POST", `/api/invoices/${invoiceId}/payments`, { ...valid, ...change }, `pay-invalid-${String(index)}`)
        assert.deepEqual([reply.status, reply.body], [400, { error: "ValidationFailure", issues: [issue] }], JSON.stringify(change))
      }
      assert.equal(await ledgerSize(call, invoiceId), 0)

      // A rejected request leaves no idempotency record: its key still records the valid payment, exactly once.
      const rejected = await call("POST", `/api/invoices/${invoiceId}/payments`, { ...valid, amount: "0.00" }, "pay-1")
      assert.equal(rejected.status, 400)
      const recorded = await ok(call("POST", `/api/invoices/${invoiceId}/payments`, valid, "pay-1"), "payment with the rejected key")
      assert.equal(await ledgerSize(call, invoiceId), 1)
      const paymentId = (recorded.payment as { id: string }).id
      for (const [index, [reason, issue]] of invalidReasons.entries()) {
        const reply = await call("POST", `/api/invoices/${invoiceId}/payments/${paymentId}/reversal`, { reason }, `rev-invalid-${String(index)}`)
        assert.deepEqual([reply.status, reply.body], [400, { error: "ValidationFailure", issues: [issue] }], `reason ${String(reason.length)}`)
      }
      assert.equal(await ledgerSize(call, invoiceId), 1)
    } finally {
      await served.close()
    }
  })
})
