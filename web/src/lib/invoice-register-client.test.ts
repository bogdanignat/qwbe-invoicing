import assert from "node:assert/strict"
import test from "node:test"

import { clearApiSession, loginApiSession, runUiEffect } from "./api.ts"
import { invoicingClient } from "./invoicing-client.ts"

const requestPath = (input: Parameters<typeof fetch>[0]): string =>
  typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url

void test("lists the dedicated invoice register endpoint through the facade", async () => {
  const originalFetch = globalThis.fetch
  const calls: Array<string> = []
  try {
    globalThis.fetch = (input) => {
      const path = requestPath(input)
      calls.push(path)
      const body = path === "/api/session"
        ? { authenticated: true, csrfToken: "csrf-token" }
        : { items: [{
          kind: "invoice", id: "invoice-1", series: "QWBE", number: 1,
          issueDate: "2026-09-21", dueDate: null, customer: { name: "Client" },
          currency: "RON", totalIncludingVat: "0.00", eFacturaStatus: "not_sent",
        }], nextCursor: null }
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200, headers: { "content-type": "application/json" },
      }))
    }
    await runUiEffect(loginApiSession("secret-token"))
    const page = await runUiEffect(invoicingClient.listInvoiceRegister({ limit: 2, cursor: "cursor/1" }))
    assert.equal(page.items[0]?.kind, "invoice")
    assert.deepEqual(calls, ["/api/session", "/api/invoice-register?limit=2&cursor=cursor%2F1"])
  } finally {
    await runUiEffect(clearApiSession)
    globalThis.fetch = originalFetch
  }
})
