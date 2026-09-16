import assert from "node:assert/strict"
import test from "node:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

import type { Proforma } from "./models.ts"

const proforma: Proforma = {
  actorId: "actor", id: "proforma-1", sourceDraftId: null, organizationId: "org", series: "PRO", number: 4,
  issueDate: "2026-09-14", dueDate: null, issuedAt: "2026-09-14T10:00:00.000Z", currency: "RON", notes: null,
  issuer: { name: "Emitent", fiscalIdentifier: "123", vatRegistered: true, legalForm: "srl", tradeRegistryNumber: "J22/1/2020", iban: "", bankName: "", socialCapital: "200", branding: null,
    address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" } },
  customer: { partyType: "company", name: "Client", fiscalIdentifier: "456", vatRegistered: false, address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } },
  lines: [], vatBreakdown: [], totalExcludingVat: "100.00", vatTotal: "21.00", totalIncludingVat: "121.00",
  convertedDraftId: null, convertedInvoiceId: null,
}

void test("offers both conversion actions with an explicit invoice series", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const module = await server.ssrLoadModule("/src/views/ProformaDetailView.tsx") as { readonly ProformaDetailView: (props: { readonly id: string }) => ReactNode }
  const render = (value: Proforma, includeSeries = true): string => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    client.setQueryData(["proforma", value.id], value)
    if (includeSeries) client.setQueryData(["document-series", "proforma-conversion", value.id], [{ organizationId: "org", documentType: "invoice", series: "INV" }])
    return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(module.ProformaDetailView, { id: value.id })))
  }
  const available = render(proforma)
  assert.match(available, /Serie factură/)
  assert.match(available, /Emite factura/)
  assert.match(available, /Creează draft de factură/)
  assert.match(available, /nu are scadență.*Creează un draft/)
  assert.ok(available.includes("Alege seria facturii"))
  assert.equal(available.match(/<button\b[^>]*\sdisabled=""[^>]*>/g)?.length, 2)
  const withoutSeries = render(proforma, false)
  assert.match(withoutSeries, /Configurează o serie de factură/)
  assert.match(withoutSeries, /href="\/settings"/)
  const converted = render({ ...proforma, convertedDraftId: "draft-1", convertedInvoiceId: "invoice-1" })
  assert.match(converted, /Facturată/)
  assert.match(converted, /\/invoices\/invoice-1/)
  assert.doesNotMatch(converted, /\/drafts\/draft-1/)
})
