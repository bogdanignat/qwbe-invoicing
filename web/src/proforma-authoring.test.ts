import assert from "node:assert/strict"
import test from "node:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

import type { ProformaAuthoringSessionInput } from "./proforma-authoring-hooks.ts"

void test("renders an independent proforma authoring session with one persistence action", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const module = await server.ssrLoadModule("/src/components/ProformaAuthoringSession.tsx") as {
    readonly ProformaAuthoringSession: (props: ProformaAuthoringSessionInput) => ReactNode
  }
  const input: ProformaAuthoringSessionInput = {
    issuer: { organizationId: "org", name: "Emitent", fiscalIdentifier: "12345674", legalForm: "pfa",
      tradeRegistryNumber: "F22/1/2020", socialCapital: "", iban: "", bankName: "", branding: { text: "Brand", image: null },
      address: { countryCode: "RO", city: "Iași", street: "Strada foarte lungă ".repeat(12), county: "RO-IS" },
      defaultCurrency: "RON", defaultPaymentTermDays: 15, currentVat: { registered: false, nonVatBasis: "article_310", effectiveFrom: "2025-08-01" },
      vatConfigurations: [{ code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "E", vatExemptionReason: "Regim special de scutire conform art. 310 din Codul fiscal", effectiveFrom: "2025-08-01" }] },
    vatCatalogue: { rates: [{ code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "E", vatExemptionReason: "Regim special de scutire conform art. 310 din Codul fiscal", effectiveFrom: "2025-08-01", kind: "non_vat", label: "Scutit TVA — art. 310" }] },
    customers: [], proformaSeries: ["PRO"], unitOfMeasures: [{ code: "C62", name: "unitate" }], backgroundErrors: [],
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  try {
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(module.ProformaAuthoringSession, input)))
    assert.match(html, /Proformă nouă/)
    assert.match(html, /Serie proformă/)
    assert.match(html, /Numărul se alocă la salvare/)
    assert.match(html, /Brand/)
    assert.equal(html.match(/Salvează proforma/g)?.length, 1)
    assert.doesNotMatch(html, /Serie factură|Salvează draftul|Emite factura|Creează draft de factură/)
  } finally { client.clear() }
})
