import assert from "node:assert/strict"
import test from "node:test"

import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query"
import { createElement } from "react"
import { renderToString } from "react-dom/server"

import { AuthContext, type AuthController } from "./auth-context.ts"
import { useCorrectionDetail, useInvoiceDetail } from "./use-document-detail.ts"
import { useEFacturaDocument } from "./use-efactura-document.ts"
import { invoicePaymentsQueries } from "./invoice-payments-query.ts"
import { collectionsQueryOptions, invalidateCollections, invalidateIssuedDocuments, revenueQueryOptions } from "./report-queries.ts"
import { useInvoicePayments } from "./use-invoice-payments.ts"
import { useInvoiceRegister } from "./use-invoice-register.ts"
import type { PluginName } from "../lib/api-contracts.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import { createInvoiceDocumentsClient } from "../lib/invoicing-clients.ts"
import { createPaymentsClient } from "../lib/payments-client.ts"
import { createReportsClient } from "../lib/reports-client.ts"
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
    requested: ["/api/invoices/inv-1", "/api/invoices/inv-1/corrections", "/api/invoices/inv-1/payments"],
  })
})

void test("invoice and storno offer the PDF alone: the XML export gave way to the e-Factura submission", () => {
  for (const hook of [() => useInvoiceDetail("inv-1"), () => useCorrectionDetail("cor-1")]) {
    for (const plugins of [["payments"], ["efactura"]] satisfies ReadonlyArray<ReadonlyArray<PluginName>>) {
      assert.deepEqual(renderHook(plugins, hook).result?.downloads.map((action) => action.key), ["pdf"], JSON.stringify(plugins))
    }
  }
})

void test("e-Factura off: no submission panel on an invoice or a storno; on, there is one", () => {
  for (const kind of ["invoice", "correction"] as const) {
    assert.equal(renderHook(["payments"], () => useEFacturaDocument(kind, "doc-1", undefined)).result, undefined, kind)
    assert.equal(typeof renderHook(["efactura"], () => useEFacturaDocument(kind, "doc-1", undefined)).result?.submit, "function", kind)
  }
})

void test("e-Factura off: the register drops its e-Factura column", () => {
  assert.equal(renderHook([], () => useInvoiceRegister()).result?.eFacturaColumn, false)
  assert.equal(renderHook(["efactura"], () => useInvoiceRegister()).result?.eFacturaColumn, true)
})

void test("payments off: the dashboard asks for revenue only, even after every write that invalidates reports", async () => {
  const range = { from: "2025-11-01", to: "2026-10-19" }
  const observe = async (plugins: ReadonlyArray<PluginName>) => {
    const { transport, requested } = countingTransport()
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const clients = { reports: createReportsClient(transport) }
    const payments = pluginActive({ status: "authenticated", plugins }, "payments")
    const observers = [
      new QueryObserver(queryClient, revenueQueryOptions(clients, range, true)),
      new QueryObserver(queryClient, collectionsQueryOptions(clients, range, "unpaid", payments)),
    ]
    const unsubscribe = observers.map((observer) => observer.subscribe(() => undefined))
    await new Promise((resolve) => setTimeout(resolve, 10))
    // An issue, a storno, a payment and its reversal all go through these two.
    invalidateIssuedDocuments(queryClient)
    invalidateCollections(queryClient)
    await new Promise((resolve) => setTimeout(resolve, 10))
    for (const stop of unsubscribe) stop()
    return [...new Set(requested)].sort()
  }
  const revenue = "/api/reports/revenue?from=2025-11-01&to=2026-10-19"
  assert.deepEqual(await observe([]), [revenue])
  assert.deepEqual(await observe(["efactura"]), [revenue])
  assert.deepEqual(await observe(["payments"]), [
    "/api/reports/collections?from=2025-11-01&to=2026-10-19&status=unpaid", revenue,
  ])
})

void test("report keys: revenue follows the interval only, collections the interval and the status", () => {
  const clients = { reports: createReportsClient(countingTransport().transport) }
  const range = { from: "2026-01-01", to: "2026-03-31" }
  assert.deepEqual(revenueQueryOptions(clients, range, true).queryKey, ["reports", "revenue", "2026-01-01", "2026-03-31"])
  assert.deepEqual(collectionsQueryOptions(clients, range, "overdue", true).queryKey,
    ["reports", "collections", "2026-01-01", "2026-03-31", "overdue"])
})
