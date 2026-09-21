import assert from "node:assert/strict"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import test from "node:test"
import { createServer } from "vite"

import type { IssuedInvoice, Proforma } from "../../lib/models.ts"
import { ARTICLE_310_EXEMPTION_REASON } from "../../lib/models.ts"

type Snapshot = Pick<Proforma, "currency" | "customer" | "dueDate" | "issueDate" | "issuer" | "lines" | "notes" | "vatBreakdown" | "totalExcludingVat" | "vatTotal" | "totalIncludingVat">
type Identity = { readonly kind: "invoice" | "proforma"; readonly series: string; readonly number: number }

const longToken = "NumeSauAdresaFaraSpatiiCareTrebuieSaRamanaIntegralVizibila"
const snapshot: Snapshot = {
  currency: "RON", issueDate: "2026-09-14", dueDate: "2026-09-29", notes: null,
  issuer: {
    name: `Emitent ${longToken}`, fiscalIdentifier: "2", vatRegistered: true, legalForm: "srl", tradeRegistryNumber: "J01/1/2026",
    iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "200", address: { countryCode: "RO", city: "Botoșani", street: longToken, county: "RO-BT" }, branding: null,
  },
  customer: { partyType: "company", name: `Client ${longToken}`, fiscalIdentifier: "1", vatRegistered: true, address: { countryCode: "RO", city: "Iași", street: longToken, county: "RO-IS" } },
  lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

void test("requires and renders real invoice and proforma identities in the shared document header", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const documentModule = await server.ssrLoadModule("/src/components/document/CommercialDocument.tsx") as {
    readonly CommercialDocument: (props: { readonly snapshot: Snapshot; readonly identity: Identity; readonly lineCaption: string }) => ReactNode
  }
  const invoiceModule = await server.ssrLoadModule("/src/components/document/InvoiceDocument.tsx") as {
    readonly InvoiceDocument: (props: { readonly invoice: IssuedInvoice }) => ReactNode
  }

  const proforma = renderToStaticMarkup(createElement(documentModule.CommercialDocument, {
    snapshot, identity: { kind: "proforma", series: "PRO", number: 42 }, lineCaption: "Linii proformă",
  }))
  assert.match(proforma, /document-header__identity/)
  assert.match(proforma, /document-header__issuer/)
  assert.match(proforma, /document-header__customer/)
  assert.match(proforma, /PROFORMĂ/)
  assert.match(proforma, /DOCUMENT NEFISCAL/)
  assert.match(proforma, /PRO 42/)
  assert.match(proforma, /Data emiterii.*2026-09-14.*Scadență.*2026-09-29.*Monedă.*RON/)
  assert.equal(proforma.match(new RegExp(longToken, "g"))?.length, 4)
  assert.doesNotMatch(proforma, /document-meta|invoice-parties|truncate|text-overflow|overflow-hidden|break-words/)
  assert.ok(proforma.indexOf("document-header__identity") < proforma.indexOf("document-header__issuer"))
  assert.ok(proforma.indexOf("document-header__issuer") < proforma.indexOf("document-header__customer"))

  const invoice: IssuedInvoice = {
    actorId: "actor-1", id: "invoice-1", draftId: null, sourceProformaId: null, series: "INV", number: 781,
    issueDate: "2026-09-14", dueDate: "2026-09-29", currency: "RON", notes: null, issuer: snapshot.issuer,
    customer: snapshot.customer, lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00", eFacturaStatus: "not_submitted",
  }
  const renderedInvoice = renderToStaticMarkup(createElement(invoiceModule.InvoiceDocument, { invoice }))
  assert.match(renderedInvoice, /FACTURĂ/)
  assert.match(renderedInvoice, /INV 781/)
  assert.match(renderedInvoice, /Data emiterii.*2026-09-14.*Scadență.*2026-09-29.*Monedă.*RON/)
  assert.doesNotMatch(renderedInvoice, /DOCUMENT NEFISCAL|document-meta|invoice-parties|Număr factură[^<]*PRO|INV 0/)

  const exemptInvoice: IssuedInvoice = {
    ...invoice,
    issuer: { ...invoice.issuer, vatRegistered: false },
    lines: [{ id: "line-e", description: "Serviciu scutit", quantity: "1.0000", unitPrice: "100.00", unitOfMeasure: { code: "C62", name: "unitate" },
      vatRateCode: "RO_NON_VAT", vatRate: "0.00", vatCategoryCode: "O", vatExemptionReason: ARTICLE_310_EXEMPTION_REASON,
      totalExcludingVat: "100.00", vatAmount: "0.00", totalIncludingVat: "100.00" }],
    vatBreakdown: [{ code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O", vatExemptionReason: ARTICLE_310_EXEMPTION_REASON,
      vatBaseAmount: "100.00", vatAmount: "0.00" }],
    totalExcludingVat: "100.00", vatTotal: "0.00", totalIncludingVat: "100.00",
  }
  const renderedExempt = renderToStaticMarkup(createElement(invoiceModule.InvoiceDocument, { invoice: exemptInvoice }))
  assert.match(renderedExempt, /Scutit TVA — art\. 310/)
  assert.equal(renderedExempt.match(new RegExp(ARTICLE_310_EXEMPTION_REASON, "g"))?.length, 1)
  assert.doesNotMatch(renderedExempt, /Cod TVA: RO2|TVA 0\.00%/)

  const withoutDueDate = renderToStaticMarkup(createElement(documentModule.CommercialDocument, {
    snapshot: { ...snapshot, currency: "EUR", dueDate: null }, identity: { kind: "proforma", series: "P", number: 1 }, lineCaption: "Linii proformă",
  }))
  assert.doesNotMatch(withoutDueDate, /Scadență/)
  assert.match(withoutDueDate, /Data emiterii.*2026-09-14.*Monedă.*EUR/)
})
