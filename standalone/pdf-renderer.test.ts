import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"
import { PDFDocument } from "pdf-lib"

import type { RenderableInvoice, RenderableProforma } from "../cube/invoicing/documents/index.ts"
import { createPdfRenderer, documentDateLine, formatAmount, formatRate, invoiceTemplateVersion, issuerLegalLines, partyIdentifierLine, proformaTemplateVersion } from "./pdf-renderer.ts"

const invoice: RenderableInvoice = {
  id: "invoice-1",
  organizationId: "org-1",
  series: "QWBE",
  number: 7,
  issueDate: "2026-09-01",
  dueDate: "2026-09-16",
  issuedAt: "2026-09-01T10:00:00.000Z",
  currency: "RON",
  notes: null,
  issuer: {
    branding: null,
    legalForm: "srl",
    tradeRegistryNumber: "J22/123/2020",
    iban: "RO49AAAA1B31007593840000",
    bankName: "Banca Română",
    socialCapital: "1000.00",
    name: "Știință și Tehnică SRL",
    fiscalIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Independenței 1" },
  },
  customer: {
    partyType: "company",
    name: "Țesături România SRL",
    fiscalIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Șoseaua Națională 2" },
  },
  lines: [{
    description: "Servicii de consultanță și analiză",
    quantity: "1.0000",
    unitPrice: "100.00",
    unitOfMeasure: { code: "HUR", name: "oră" },
    vatRate: "21.00",
    totalExcludingVat: "100.00",
    vatAmount: "21.00",
    totalIncludingVat: "121.00",
  }],
  vatBreakdown: [{ rate: "21.00", vatBaseAmount: "100.00", vatAmount: "21.00" }],
  totalExcludingVat: "100.00",
  vatTotal: "21.00",
  totalIncludingVat: "121.00",
}

void test("renders deterministic valid PDFs with Romanian glyphs and fixed metadata", async () => {
  const renderer = createPdfRenderer()
  const first = await Effect.runPromise(renderer.render(invoice))
  const second = await Effect.runPromise(renderer.render(invoice))

  assert.equal(first.templateVersion, invoiceTemplateVersion)
  assert.equal(first.mediaType, "application/pdf")
  assert.equal(Buffer.from(first.bytes.subarray(0, 5)).toString("ascii"), "%PDF-")
  assert.deepEqual(first.bytes, second.bytes)

  const parsed = await PDFDocument.load(first.bytes, { updateMetadata: false })
  assert.equal(parsed.getPageCount(), 1)
  assert.equal(parsed.getTitle(), "Factura QWBE 7")
  assert.equal(parsed.getAuthor(), "Știință și Tehnică SRL")
  assert.equal(parsed.getCreationDate()?.toISOString(), invoice.issuedAt)
})

void test("renders canonical issuer legal details and omits empty optional detail lines", async () => {
  assert.deepEqual(issuerLegalLines(invoice.issuer), [
    "Formă juridică: SRL", "Nr. registrul comerțului: J22/123/2020", "Capital social: 1.000,00 RON",
    "Bancă: Banca Română", "IBAN: RO49AAAA1B31007593840000",
  ])
  assert.deepEqual(issuerLegalLines({ ...invoice.issuer, tradeRegistryNumber: "", socialCapital: "", bankName: "", iban: "" }),
    ["Formă juridică: SRL"])
  const longDetails = { ...invoice, issuer: { ...invoice.issuer, tradeRegistryNumber: "J".repeat(32),
    bankName: "Bancă foarte lungă ".repeat(7).slice(0, 120), iban: "RO49" + "A".repeat(30) } }
  const rendered = await Effect.runPromise(createPdfRenderer().render(longDetails))
  assert.ok((await PDFDocument.load(rendered.bytes, { updateMetadata: false })).getPageCount() >= 1)
})

void test("renders an individual buyer with a CNP label and omits an empty identifier", async () => {
  const individual = { ...invoice.customer, partyType: "individual" as const, name: "Ion Popescu", fiscalIdentifier: "1800101221144" }
  assert.equal(partyIdentifierLine(individual), "CNP: 1800101221144")
  assert.equal(partyIdentifierLine({ ...individual, fiscalIdentifier: "" }), undefined)
  assert.equal(partyIdentifierLine(invoice.issuer), "CUI: RO12345674")
  const rendered = await Effect.runPromise(createPdfRenderer().render({ ...invoice, customer: individual }))
  const parsed = await PDFDocument.load(rendered.bytes, { updateMetadata: false })
  assert.equal(parsed.getPageCount(), 1)
})

void test("paginates long descriptions and unbroken Romanian text", async () => {
  const baseLine = invoice.lines[0]
  assert.ok(baseLine !== undefined)
  const longInvoice: RenderableInvoice = {
    ...invoice,
    lines: Array.from({ length: 20 }, (_, index) => ({
      ...baseLine,
      description: `${String(index + 1)} ${"ȚarăȘtiință".repeat(100)}`,
    })),
  }
  const rendered = await Effect.runPromise(createPdfRenderer().render(longInvoice))
  const parsed = await PDFDocument.load(rendered.bytes, { updateMetadata: false })
  assert.ok(parsed.getPageCount() > 1)
})

void test("renders deterministic non-fiscal proformas and omits a null due date", async () => {
  const proforma: RenderableProforma = {
    ...invoice,
    id: "proforma-1",
    sourceDraftId: "draft-1",
    invoiceSeries: "QWBE",
    convertedDraftId: null,
    convertedInvoiceId: null,
    dueDate: null,
  }
  assert.equal(documentDateLine(proforma), "Data emiterii: 2026-09-01")
  assert.equal(documentDateLine(invoice), "Data emiterii: 2026-09-01   Scadență: 2026-09-16")
  const renderer = createPdfRenderer()
  const first = await Effect.runPromise(renderer.renderProforma(proforma))
  const second = await Effect.runPromise(renderer.renderProforma(proforma))
  assert.deepEqual(first.bytes, second.bytes)
  assert.equal(first.templateVersion, proformaTemplateVersion)
  const parsed = await PDFDocument.load(first.bytes, { updateMetadata: false })
  assert.equal(parsed.getTitle(), "Proformă QWBE 7")
  assert.equal(parsed.getSubject(), "PROFORMĂ — DOCUMENT NEFISCAL")
  assert.equal(parsed.getProducer(), `QWBE Invoicing ${proformaTemplateVersion}`)
})

void test("formats amounts with Romanian grouping and leaves unknown shapes untouched", () => {
  assert.equal(formatAmount("11761.00"), "11.761,00")
  assert.equal(formatAmount("4800.0000"), "4.800,0000")
  assert.equal(formatAmount("100.00"), "100,00")
  assert.equal(formatAmount("999"), "999")
  assert.equal(formatAmount("1000"), "1.000")
  assert.equal(formatAmount("-1234.56"), "-1.234,56")
  assert.equal(formatAmount("n/a"), "n/a")
})

void test("compacts VAT rates without losing meaningful decimals", () => {
  assert.equal(formatRate("21.00"), "21")
  assert.equal(formatRate("0.00"), "0")
  assert.equal(formatRate("20.50"), "20,5")
  assert.equal(formatRate("9"), "9")
})

void test("keeps the redesigned template on a single page for a multi-rate invoice", async () => {
  const base = invoice.lines[0]
  assert.ok(base !== undefined)
  const multiRate: RenderableInvoice = {
    ...invoice,
    lines: [
      { ...base, vatRate: "21.00" },
      { ...base, description: "Suport", vatRate: "11.00", vatAmount: "11.00" },
      { ...base, description: "Transport", vatRate: "0.00", vatAmount: "0.00" },
    ],
    vatBreakdown: [
      { rate: "21.00", vatBaseAmount: "100.00", vatAmount: "21.00" },
      { rate: "11.00", vatBaseAmount: "100.00", vatAmount: "11.00" },
      { rate: "0.00", vatBaseAmount: "100.00", vatAmount: "0.00" },
    ],
  }
  const rendered = await Effect.runPromise(createPdfRenderer().render(multiRate))
  const parsed = await PDFDocument.load(rendered.bytes, { updateMetadata: false })
  assert.equal(parsed.getPageCount(), 1)
})

void test("renders document remarks without truncation and keeps the proforma legal notice", async () => {
  const renderer = createPdfRenderer()
  const withNotes: RenderableInvoice = { ...invoice, notes: "Livrare în tranșe.\nGaranție 24 de luni pentru piesele înlocuite." }
  const first = await Effect.runPromise(renderer.render(withNotes))
  const second = await Effect.runPromise(renderer.render(withNotes))
  assert.deepEqual(first.bytes, second.bytes)
  assert.equal(first.templateVersion, invoiceTemplateVersion)
  const parsed = await PDFDocument.load(first.bytes, { updateMetadata: false })
  assert.equal(parsed.getPageCount(), 1)
  const plain = await Effect.runPromise(renderer.render(invoice))
  assert.ok(first.bytes.length > plain.bytes.length)

  const maximum = await Effect.runPromise(renderer.render({ ...invoice, notes: "ș".repeat(500) }))
  assert.equal((await PDFDocument.load(maximum.bytes, { updateMetadata: false })).getPageCount(), 1)

  const base = invoice.lines[0]
  assert.ok(base !== undefined)
  const crowded = await Effect.runPromise(renderer.render({
    ...invoice,
    lines: Array.from({ length: 30 }, (_, index) => ({ ...base, description: `Poziția ${String(index + 1)}` })),
    notes: Array.from({ length: 10 }, (_, index) => `Paragraful ${String(index + 1)} cu observații detaliate.`).join("\n"),
  }))
  assert.ok((await PDFDocument.load(crowded.bytes, { updateMetadata: false })).getPageCount() > 1)

  const proforma: RenderableProforma = {
    ...invoice, id: "proforma-1", sourceDraftId: null, invoiceSeries: "QWBE",
    convertedDraftId: null, convertedInvoiceId: null, notes: "Ofertă valabilă 30 de zile.",
  }
  const rendered = await Effect.runPromise(renderer.renderProforma(proforma))
  assert.equal(rendered.templateVersion, proformaTemplateVersion)
  const withoutNotes = await Effect.runPromise(renderer.renderProforma({ ...proforma, notes: null }))
  assert.ok(rendered.bytes.length > withoutNotes.bytes.length)
  assert.equal((await PDFDocument.load(rendered.bytes, { updateMetadata: false })).getPageCount(), 1)
})
