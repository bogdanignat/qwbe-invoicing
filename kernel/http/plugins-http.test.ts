import assert from "node:assert/strict"
import test from "node:test"

import type { PluginSelection } from "../plugins.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import {
  customer, documentedPaths, dueDate, issueDate, issueInvoice, lines, ok, payment, seed, serve,
} from "./plugins-http.test-support.ts"

/** `QWBE_PLUGINS` end to end, for each of the four payments x e-Factura combinations; company-lookup rides along. */
const combinations: ReadonlyArray<PluginSelection> = [
  { payments: true, efactura: true, "company-lookup": true }, { payments: false, efactura: true, "company-lookup": false },
  { payments: true, efactura: false, "company-lookup": true }, { payments: false, efactura: false, "company-lookup": false },
]

for (const plugins of combinations) {
  void test(`plugins ${JSON.stringify(plugins)}: the core works, the plugins that are off are absent`, async () => {
    await withMigrated(`plugins_${String(plugins.payments)}_${String(plugins.efactura)}`, async (fixture) => {
      const served = await serve(fixture, plugins)
      const { call } = served
      try {
        const names = [...plugins.payments ? ["payments"] : [], ...plugins.efactura ? ["efactura"] : [],
          ...plugins["company-lookup"] ? ["company-lookup"] : []]
        assert.deepEqual(served.login.plugins, names, "login")
        assert.deepEqual((await ok(call("GET", "/api/session"), "session")).plugins, names, "session")
        await seed(served)
        const status = plugins.efactura ? "not_sent" : null
        const invoice = await issueInvoice(call, "issue-1")
        const id = String(invoice.id)
        assert.equal(invoice.eFacturaStatus, status, "issuance")
        assert.equal((await ok(call("GET", `/api/invoices/${id}`), "detail")).eFacturaStatus, status, "detail")
        const list = await ok(call("GET", "/api/invoices"), "list") as { items: ReadonlyArray<{ eFacturaStatus: unknown }> }
        assert.deepEqual(list.items.map((item) => item.eFacturaStatus), [status], "list")
        const proforma = await ok(call("POST", "/api/proformas",
          { customer, proformaSeries: "PRO", issueDate, dueDate, currency: "RON", lines }, "proforma-1"), "proforma")
        const converted = await ok(call("POST", `/api/proformas/${String(proforma.id)}/invoice`, { invoiceSeries: "QWBE" },
          "convert-1"), "conversion")
        assert.equal(converted.eFacturaStatus, status, "conversion")
        const correction = await ok(call("POST", `/api/invoices/${id}/corrections`, { reason: "Anulare" }, "storno-1"), "storno")
        const register = await ok(call("GET", "/api/invoice-register"), "register") as
          { items: ReadonlyArray<{ kind: string, eFacturaStatus: unknown }> }
        assert.deepEqual(register.items.map((row) => [row.kind, row.eFacturaStatus]).sort(),
          [["correction", null], ["invoice", status], ["invoice", status]], "register")

        await ok(call("POST", `/api/invoices/${id}/pdf`, {}), "render invoice pdf")
        for (const path of [`/api/invoices/${id}/pdf`, `/api/corrections/${String(correction.id)}/pdf`]) {
          const pdf = await call("GET", path)
          assert.deepEqual([pdf.status, pdf.type], [200, "application/pdf"], path)
        }
        await ok(call("POST", `/api/proformas/${String(proforma.id)}/pdf`, {}), "render proforma pdf")

        const plugin = async (active: boolean, method: string, path: string, body?: unknown, key?: string) => {
          const reply = await call(method, path, body, key)
          if (active) assert.equal(reply.status, 200, `${method} ${path}: ${JSON.stringify(reply.body)}`)
          else assert.deepEqual([reply.status, reply.body], [404, { error: "not_found" }], `${method} ${path}`)
        }
        await plugin(plugins.payments, "POST", `/api/invoices/${String(converted.id)}/payments`, payment, "pay-1")
        await plugin(plugins.payments, "GET", `/api/invoices/${String(converted.id)}/payments`)
        if (!plugins.payments) await plugin(false, "POST", `/api/invoices/${id}/payments/any/reversal`, { reason: "x" }, "rev-1")
        await plugin(plugins.efactura, "GET", `/api/invoices/${id}/efactura.xml`)
        await plugin(plugins.efactura, "GET", `/api/corrections/${String(correction.id)}/efactura.xml`)

        const paths = await documentedPaths(call)
        assert.ok(paths.includes("/api/invoices/{invoiceId}/corrections"))
        assert.equal(paths.includes("/api/invoices/{invoiceId}/payments"), plugins.payments, "payments in OpenAPI")
        assert.equal(paths.includes("/api/invoices/{invoiceId}/payments/{paymentId}/reversal"), plugins.payments)
        assert.equal(paths.includes("/api/invoices/{id}/efactura.xml"), plugins.efactura, "e-Factura in OpenAPI")
        assert.equal(paths.includes("/api/corrections/{id}/efactura.xml"), plugins.efactura)
      } finally {
        await served.close()
      }
    })
  })
}
