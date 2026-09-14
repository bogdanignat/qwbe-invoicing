import assert from "node:assert/strict"
import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import test from "node:test"
import { createServer } from "vite"

import type { IssuedInvoice, Proforma } from "./models.ts"

type Snapshot = Pick<Proforma, "currency" | "customer" | "dueDate" | "issueDate" | "issuer" | "lines" | "notes" | "vatBreakdown" | "totalExcludingVat" | "vatTotal" | "totalIncludingVat">
type Identity = { readonly kind: "invoice" | "proforma"; readonly series: string; readonly number: number }

const longToken = "NumeSauAdresaFaraSpatiiCareTrebuieSaRamanaIntegralVizibila"
const snapshot: Snapshot = {
  currency: "RON", issueDate: "2026-09-14", dueDate: "2026-09-29", notes: null,
  issuer: {
    name: `Emitent ${longToken}`, fiscalIdentifier: "RO2", legalForm: "srl", tradeRegistryNumber: "J01/1/2026",
    iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "200", address: { countryCode: "RO", city: "Botoșani", street: longToken }, branding: null,
  },
  customer: { partyType: "company", name: `Client ${longToken}`, fiscalIdentifier: "RO1", address: { countryCode: "RO", city: "Iași", street: longToken } },
  lines: [], vatBreakdown: [], totalExcludingVat: "0.00", vatTotal: "0.00", totalIncludingVat: "0.00",
}

void test("requires and renders real invoice and proforma identities in the shared document header", async (context) => {
  const server = await createServer({ appType: "custom", server: { middlewareMode: true, hmr: false } })
  context.after(async () => { await server.close() })
  const documentModule = await server.ssrLoadModule("/src/components/CommercialDocument.tsx") as {
    readonly CommercialDocument: (props: { readonly snapshot: Snapshot; readonly identity: Identity; readonly lineCaption: string }) => ReactNode
  }
  const invoiceModule = await server.ssrLoadModule("/src/components/InvoiceDocument.tsx") as {
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

  const withoutDueDate = renderToStaticMarkup(createElement(documentModule.CommercialDocument, {
    snapshot: { ...snapshot, currency: "EUR", dueDate: null }, identity: { kind: "proforma", series: "P", number: 1 }, lineCaption: "Linii proformă",
  }))
  assert.doesNotMatch(withoutDueDate, /Scadență/)
  assert.match(withoutDueDate, /Data emiterii.*2026-09-14.*Monedă.*EUR/)
})
