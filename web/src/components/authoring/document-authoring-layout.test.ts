import assert from "node:assert/strict"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import test from "node:test"
import { createServer } from "vite"
import type { InvoiceAuthoringSessionInput } from "../../hooks/invoice-authoring-session-hooks.ts"
import type { DraftInvoice } from "../../lib/models.ts"

void test("new documents and saved drafts use the same centered header without assigning a fiscal number", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const module = await server.ssrLoadModule("/src/components/authoring/InvoiceAuthoringSession.tsx") as {
    readonly InvoiceAuthoringSession: (props: InvoiceAuthoringSessionInput) => ReactNode
  }
  const input: InvoiceAuthoringSessionInput = {
    issuer: { organizationId: "org", name: "Emitent", fiscalIdentifier: "12345674", legalForm: "pfa",
      tradeRegistryNumber: "F22/1/2020", socialCapital: "", iban: "", bankName: "", branding: null,
      address: { countryCode: "RO", city: "Iași", street: "AdresaFaraSpatii".repeat(10), county: "RO-IS" },
      defaultCurrency: "RON", defaultPaymentTermDays: 15, currentVat: { registered: false, nonVatBasis: "article_310", effectiveFrom: "2025-08-01" },
      vatConfigurations: [
        { code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, effectiveFrom: "2025-08-01", effectiveTo: "2025-12-31" },
        { code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: "Regim special de scutire conform art. 310 din Codul fiscal", effectiveFrom: "2026-01-01" },
      ] },
    vatCatalogue: { rates: [
      { code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, effectiveFrom: "2025-08-01", effectiveTo: "2025-12-31", kind: "standard", label: "TVA standard 21%" },
      { code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: "Regim special de scutire conform art. 310 din Codul fiscal", effectiveFrom: "2026-01-01", kind: "non_vat", label: "Scutit TVA — art. 310" },
    ] },
    customers: [], invoiceSeries: ["INV"], unitOfMeasures: [{ code: "C62", name: "unitate" }],
    backgroundErrors: [], notify: () => undefined,
  }
  const draft: DraftInvoice = { id: "draft", organizationId: "org", sourceProformaId: null, series: "INV", issueDate: "2025-09-14", dueDate: null,
    currency: "RON", notes: "Note păstrate", status: "draft", lines: [], vatBreakdown: [],
    totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
    customer: { partyType: "individual", name: "Client", fiscalIdentifier: "", vatRegistered: false, address: input.issuer.address } }
  for (const props of [input, { ...input, initialDraft: draft }]) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    try {
      const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(module.InvoiceAuthoringSession, props)))
      assert.ok(html.includes("document-header__identity"))
      assert.ok(html.includes("document-header__issuer"))
      assert.ok(html.includes("document-header__customer"))
      const identity = html.indexOf("document-header__identity")
      const issuer = html.indexOf("document-header__issuer")
      const customer = html.indexOf("document-header__customer")
      assert.ok(identity < html.indexOf("Data emiterii") && html.indexOf("Data emiterii") < issuer)
      assert.ok(issuer < html.indexOf("Emitent") && html.indexOf("Emitent") < customer)
      assert.ok(customer < html.indexOf("Cumpărător"))
      assert.match(html, /Numărul se alocă la emitere/)
      assert.match(html, /<span class="document-address">/)
      assert.doesNotMatch(html, /document-header__customer"><section class="document-party/)
      assert.match(html, /Salvează draftul/)
      assert.match(html, /Emite factura/)
      assert.match(html, /Observații/)
      if (!("initialDraft" in props)) assert.match(html, /Cumpărător înregistrat în scopuri de TVA/)
      if ("initialDraft" in props) assert.match(html, /Cod TVA:.*RO12345674/)
      else assert.doesNotMatch(html, /Cod TVA:.*RO12345674/)
      assert.match(html, /Alege județul/)
      assert.equal(html.match(/type="date"/g)?.length, 2)
      const seriesField = html.slice(html.indexOf("Serie factură"), html.indexOf("Data emiterii"))
      assert.equal(seriesField.includes("disabled"), "initialDraft" in props)
      assert.doesNotMatch(html, /Număr factură|INV 0/)
    } finally { client.clear() }
  }
  const derived = { ...draft, sourceProformaId: "proforma-1" }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(module.InvoiceAuthoringSession, { ...input, initialDraft: derived })))
    assert.doesNotMatch(html, /Șterge draftul/)
    assert.match(html, /Nu poate fi șters/)
    assert.match(html, /\/proformas\/proforma-1/)
    assert.match(html, /Salvează draftul/)
    assert.match(html, /Emite factura/)
  } finally { client.clear() }
})
