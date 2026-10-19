import assert from "node:assert/strict"
import test from "node:test"

import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { issueInvoice, ok, payment, seed, serve } from "./plugins-http.test-support.ts"

void test("payments switched off and on again over the same database keeps payments and their idempotency", async () => {
  await withMigrated("plugins_restart", async (fixture) => {
    const first = await serve(fixture, { payments: true, efactura: true, "company-lookup": false })
    let invoiceId: string
    let recorded: Record<string, unknown>
    try {
      await seed(first)
      invoiceId = String((await issueInvoice(first.call, "issue-1")).id)
      recorded = await ok(first.call("POST", `/api/invoices/${invoiceId}/payments`, payment, "pay-1"), "record")
    } finally {
      await first.close()
    }

    const off = await serve(fixture, { payments: false, efactura: true, "company-lookup": false })
    try {
      assert.equal((await off.call("GET", `/api/invoices/${invoiceId}/payments`)).status, 404)
      assert.equal((await off.call("POST", `/api/invoices/${invoiceId}/payments`, payment, "pay-1")).status, 404)
      assert.equal((await ok(off.call("GET", `/api/invoices/${invoiceId}`), "detail while off")).id, invoiceId)
    } finally {
      await off.close()
    }

    const again = await serve(fixture, { payments: true, efactura: true, "company-lookup": false })
    try {
      const summary = await ok(again.call("GET", `/api/invoices/${invoiceId}/payments`), "list") as
        { status: string, paidAmount: string, payments: ReadonlyArray<unknown> }
      assert.deepEqual([summary.status, summary.paidAmount, summary.payments.length], ["partially_paid", "50.00", 1])
      assert.deepEqual(await ok(again.call("POST", `/api/invoices/${invoiceId}/payments`, payment, "pay-1"), "replay"), recorded)
      assert.equal((await again.call("POST", `/api/invoices/${invoiceId}/payments`, { ...payment, amount: "10.00" }, "pay-1")).status, 409)
      assert.equal((await ok(again.call("GET", `/api/invoices/${invoiceId}/payments`), "after replay") as
        { payments: ReadonlyArray<unknown> }).payments.length, 1)
    } finally {
      await again.close()
    }
  })
})

void test("a mounted payments route refuses like a core route: 401 without credential, 403 without CSRF", async () => {
  await withMigrated("plugins_payments_auth", async (fixture) => {
    const served = await serve(fixture, { payments: true, efactura: false, "company-lookup": false })
    const { origin, cookie } = served
    try {
      const refusal = async (path: string, init: RequestInit) => {
        const response = await fetch(`${origin}${path}`, init)
        return [response.status, await response.json()]
      }
      const post = (headers: Record<string, string>): RequestInit => ({ method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "k-1", ...headers }, body: JSON.stringify(payment) })
      const anonymous = await refusal("/api/invoices/missing/payments", {})
      assert.equal(anonymous[0], 401)
      assert.deepEqual(anonymous, await refusal("/api/invoices/missing", {}))
      const withoutCsrf = await refusal("/api/invoices/missing/payments", post({ cookie, origin }))
      assert.equal(withoutCsrf[0], 403)
      assert.deepEqual(withoutCsrf, await refusal("/api/invoices/missing/corrections", post({ cookie, origin })))
    } finally {
      await served.close()
    }
  })
})
