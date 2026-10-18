import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { AuthContext, type AuthController } from "./auth-context.ts"
import { useCorrectionDetail, useInvoiceDetail } from "./use-document-detail.ts"
import { invoicePaymentsQueries } from "./invoice-payments-query.ts"
import { useInvoicePayments } from "./use-invoice-payments.ts"
import { useInvoiceRegister } from "./use-invoice-register.ts"
import type { PluginName } from "../lib/api-contracts.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import { createInvoiceDocumentsClient } from "../lib/invoicing-clients.ts"
import { createPaymentsClient } from "../lib/payments-client.ts"
import { pluginActive } from "../lib/plugins.ts"

/**
 * What the screens ask of a plugin the session does not list: nothing.
 * `renderToString` runs a hook once for the model it returns, but subscribes no
 * query observer, so it cannot show that nothing is fetched. That proof is made
 * by subscribed `QueryObserver`s on a transport whose every request is counted,
 * with the plugin on as the control on the same path.
 */

const countingTransport = () => {
  const requested: Array<string> = []
  const transport = createBrowserTransport({
    fetch: (input) => { requested.push(typeof input === "string" ? input : "not-a-path"); return Promise.resolve(Response.json({})) },
    onUnauthorized: () => undefined,
  })
  return { transport, requested }
}

const authWith = (plugins: ReadonlyArray<PluginName>, transport: AuthController["transport"]): AuthController => ({
  status: "authenticated", error: undefined, loginPending: false, logoutPending: false, plugins,
  login: () => Promise.resolve(), logout: () => Promise.resolve(), retryRestore: () => Promise.resolve(),
  transport, csrfToken: () => "csrf", epoch: () => 1, ownsEpoch: () => true,
})

/** Runs `hook` once inside the providers and hands back what it returned. */
const renderHook = <Result>(plugins: ReadonlyArray<PluginName>, hook: () => Result) => {
  const { transport } = countingTransport()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let result: Result | undefined
  const Probe = () => { result = hook(); return null }
  renderToString(createElement(QueryClientProvider, { client: queryClient },
    createElement(AuthContext, { value: authWith(plugins, transport) }, createElement(Probe))))
  return { result }
}

void test("payments off: no payments model, so no panel and no write to start", () => {
  const off = renderHook(["efactura"], () => useInvoicePayments("inv-1"))
  assert.equal(off.result, undefined)
  const on = renderHook(["payments"], () => useInvoicePayments("inv-1"))
  assert.equal(typeof on.result?.record, "function")
})

void test("payments off: none of the panel's three reads fetches, even when the invoice is invalidated", async () => {
  const observe = async (plugins: ReadonlyArray<PluginName>) => {
    const { transport, requested } = countingTransport()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const enabled = pluginActive({ status: "authenticated", plugins }, "payments")
    const clients = { payments: createPaymentsClient(transport), documents: createInvoiceDocumentsClient(transport) }
    const { ledger, invoice, corrections } = invoicePaymentsQueries(clients, "inv-1", enabled)
    const observers = [
      new QueryObserver(queryClient, ledger), new QueryObserver(queryClient, invoice), new QueryObserver(queryClient, corrections),
    ]
    const unsubscribe = observers.map((observer) => observer.subscribe(() => undefined))
    await new Promise((resolve) => setTimeout(resolve, 10))
    // A storno or a replay invalidates everything under the invoice's key.
    await queryClient.invalidateQueries({ queryKey: ["invoice", "inv-1"] })
    await new Promise((resolve) => setTimeout(resolve, 10))
    for (const stop of unsubscribe) stop()
    return { enabled: [ledger.enabled, invoice.enabled, corrections.enabled], requested: [...new Set(requested)].sort() }
  }
  for (const plugins of [[], ["efactura"]] satisfies ReadonlyArray<ReadonlyArray<PluginName>>) {
    assert.deepEqual(await observe(plugins), { enabled: [false, false, false], requested: [] }, JSON.stringify(plugins))
  }
  // The control: with the plugin on, the same observers reach all three routes.
  assert.deepEqual(await observe(["payments"]), {
    enabled: [true, true, true],
    requested: ["/api/qwbe/invoices/inv-1", "/api/qwbe/invoices/inv-1/corrections", "/api/qwbe/invoices/inv-1/payments"],
  })
})

void test("e-Factura off: invoice and storno offer the PDF alone, no XML action", () => {
  for (const hook of [() => useInvoiceDetail("inv-1"), () => useCorrectionDetail("cor-1")]) {
    const off = renderHook(["payments"], hook)
    assert.deepEqual(off.result?.downloads.map((action) => action.key), ["pdf"])
    assert.deepEqual(renderHook(["efactura"], hook).result?.downloads.map((action) => action.key), ["pdf", "efactura"])
  }
})

void test("e-Factura off: the register drops its e-Factura column", () => {
  assert.equal(renderHook([], () => useInvoiceRegister()).result?.eFacturaColumn, false)
  assert.equal(renderHook(["efactura"], () => useInvoiceRegister()).result?.eFacturaColumn, true)
})
