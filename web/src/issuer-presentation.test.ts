import assert from "node:assert/strict"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import test from "node:test"
import { createServer } from "vite"

import type { Issuer, Proforma } from "./models.ts"

const issuer: Issuer = {
  organizationId: "org-1", name: "QWBE", fiscalIdentifier: "RO2", legalForm: "pfa", tradeRegistryNumber: "F1234567890123",
  iban: "RO49AAAA1B31007593840000", bankName: "Banca Exemplu cu denumire suficient de lungă", socialCapital: "",
  address: { countryCode: "RO", city: "Botoșani", street: "Strada 2" }, branding: null,
  defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations: [],
}

void test("renders issuer legal and payment details without an empty PFA capital line", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const sellerModule = await server.ssrLoadModule("/src/components/SellerSummary.tsx") as {
    readonly SellerSummary: (props: { readonly issuer: Issuer }) => ReactNode
  }
  const documentModule = await server.ssrLoadModule("/src/components/CommercialDocument.tsx") as {
    readonly CommercialDocument: (props: { readonly snapshot: Pick<Proforma, "currency" | "customer" | "dueDate" | "issueDate" | "issuer" | "lines" | "notes" | "vatBreakdown" | "totalExcludingVat" | "vatTotal" | "totalIncludingVat">; readonly lineCaption: string }) => ReactNode
  }
  const seller = renderToStaticMarkup(createElement(sellerModule.SellerSummary, { issuer }))
  assert.match(seller, /F1234567890123/)
  assert.match(seller, /RO49AAAA1B31007593840000/)
  assert.doesNotMatch(seller, /Capital social/)
  assert.match(seller, /overflow-wrap:anywhere/)

  const snapshot: Pick<Proforma, "currency" | "customer" | "dueDate" | "issueDate" | "issuer" | "lines" | "notes" | "vatBreakdown" | "totalExcludingVat" | "vatTotal" | "totalIncludingVat"> = {
    currency: "RON", issueDate: "2026-09-11", dueDate: null, notes: null, issuer,
    customer: { partyType: "company", name: "Client", fiscalIdentifier: "RO1", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } },
    lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
  }
  const document = renderToStaticMarkup(createElement(documentModule.CommercialDocument, { snapshot, lineCaption: "Linii" }))
  assert.match(document, /Nr. Reg. Com.:/)
  assert.match(document, /Bancă:/)
  assert.doesNotMatch(document, /Capital social:/)
})
