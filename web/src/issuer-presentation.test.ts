import assert from "node:assert/strict"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import test from "node:test"
import { createServer } from "vite"

import type { Issuer, Proforma } from "./models.ts"

type Snapshot = Pick<Proforma, "currency" | "customer" | "dueDate" | "issueDate" | "issuer" | "lines" | "notes" | "vatBreakdown" | "totalExcludingVat" | "vatTotal" | "totalIncludingVat">

const longToken = "StradaFaraSpatiiCareTrebuieAfisataIntegralFaraTrunchiere"
const issuer: Issuer = {
  organizationId: "org-1", name: "Cabinet Individual Exemplu", fiscalIdentifier: "RO2", legalForm: "pfa", tradeRegistryNumber: "F1234567890123",
  iban: "RO49AAAA1B31007593840000", bankName: "Banca Exemplu cu denumire suficient de lungă", socialCapital: "",
  address: { countryCode: "RO", city: "Botoșani", street: longToken, county: "Botoșani", postalCode: "710001" },
  branding: { text: "MARCA EMITENTULUI", image: null }, defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations: [],
  currentVat: { registered: true, effectiveFrom: "2025-08-01" },
}

void test("shares compact, complete issuer presentation between authoring and readonly documents", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const sellerModule = await server.ssrLoadModule("/src/components/SellerSummary.tsx") as {
    readonly SellerSummary: (props: { readonly issuer: Issuer }) => ReactNode
  }
  const documentModule = await server.ssrLoadModule("/src/components/CommercialDocument.tsx") as {
    readonly CommercialDocument: (props: { readonly snapshot: Snapshot; readonly identity: { readonly kind: "invoice" | "proforma"; readonly series: string; readonly number: number }; readonly lineCaption: string }) => ReactNode
  }

  const seller = renderToStaticMarkup(createElement(sellerModule.SellerSummary, { issuer }))
  for (const value of ["Cabinet Individual Exemplu", "MARCA EMITENTULUI", "PFA", "RO2", "F1234567890123", "RO49AAAA1B31007593840000", "Banca Exemplu", longToken, "Botoșani", "710001", "RO"]) assert.match(seller, new RegExp(value))
  assert.match(seller, /class="seller-summary document-party"/)
  assert.match(seller, /href="\/settings"/)
  assert.doesNotMatch(seller, /card authoring-section|summary-list|Capital social/)

  const snapshot: Snapshot = {
    currency: "RON", issueDate: "2026-09-11", dueDate: null, notes: null, issuer,
    customer: { partyType: "company", name: "Client", fiscalIdentifier: "RO1", address: { countryCode: "RO", city: "Iași", street: "Strada 1" } },
    lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
  }
  const document = renderToStaticMarkup(createElement(documentModule.CommercialDocument, {
    snapshot, identity: { kind: "proforma", series: "PRO", number: 9 }, lineCaption: "Linii",
  }))
  for (const value of ["Cabinet Individual Exemplu", "MARCA EMITENTULUI", "F1234567890123", "RO49AAAA1B31007593840000", "Banca Exemplu", longToken, "Botoșani", "710001", "RO"]) assert.match(document, new RegExp(value))
  assert.match(document, /document-address/)
  assert.doesNotMatch(document, /Capital social:/)
})
