import assert from "node:assert/strict"
import test from "node:test"

import { allPlugins } from "../plugins.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { customer, dueDate, issueDate, issueInvoice, lines, ok, seed, serve } from "./plugins-http.test-support.ts"

void test("rendering a proforma PDF needs no request body, like an invoice PDF", async () => {
  await withMigrated("proforma_pdf_empty_body", async (fixture) => {
    const served = await serve(fixture, allPlugins)
    const { call } = served
    try {
      await seed(served)
      const invoice = await issueInvoice(call, "issue-1")
      const proforma = await ok(call("POST", "/api/proformas",
        { customer, proformaSeries: "PRO", issueDate, dueDate, currency: "RON", lines }, "proforma-1"), "proforma")
      // No body and no content-type: what a bare `curl -X POST` sends.
      const render = (path: string) => fetch(`${served.origin}${path}`, { method: "POST",
        headers: { cookie: served.cookie, origin: served.origin, "x-csrf-token": served.csrfToken } })
      for (const path of [`/api/invoices/${String(invoice.id)}/pdf`, `/api/proformas/${String(proforma.id)}/pdf`]) {
        const reply = await render(path)
        assert.equal(reply.status, 200, `${path}: ${await reply.text()}`)
      }
    } finally {
      await served.close()
    }
  })
})
