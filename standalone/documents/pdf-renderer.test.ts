import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"
import { PDFDocument } from "pdf-lib"

import type { RenderableInvoice, RenderableProforma } from "../../cube/invoicing/documents/index.ts"
import { createPdfRenderer, documentDateLine, formatAmount, formatRate, invoiceTemplateVersion, issuerLegalLines, partyIdentifierLine, proformaTemplateVersion } from "./pdf-renderer.ts"

const article310VatExemptionReason = "Regim special de scutire conform art. 310 din Codul fiscal"
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
    vatRegistered: true,
    legalForm: "srl",
    tradeRegistryNumber: "J22/123/2020",
    iban: "RO49AAAA1B31007593840000",
    bankName: "Banca Română",
    socialCapital: "1000.00",
    name: "Știință și Tehnică SRL",
    fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Independenței 1", county: "RO-BT" },
  },
  customer: {
    partyType: "company",
    vatRegistered: true,
    name: "Țesături România SRL",
    fiscalIdentifier: "87654329",
    address: { countryCode: "RO", city: "Iași", street: "Șoseaua Națională 2", county: "RO-IS" },
  },
  lines: [{
    description: "Servicii de consultanță și analiză",
    quantity: "1.0000",
    unitPrice: "100.00",
    unitOfMeasure: { code: "HUR", name: "oră" },
    vatRate: "21.00",
    vatCategoryCode: "S",
    vatExemptionReason: null,
    totalExcludingVat: "100.00",
    vatAmount: "21.00",
    totalIncludingVat: "121.00",
  }],
  vatBreakdown: [{ rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null,
    vatBaseAmount: "100.00", vatAmount: "21.00" }],
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
    "Formă juridică: SRL", "Plătitor de TVA", "Nr. registrul comerțului: J22/123/2020", "Capital social: 1.000,00 RON",
    "Bancă: Banca Română", "IBAN: RO49AAAA1B31007593840000",
  ])
  assert.deepEqual(issuerLegalLines({ ...invoice.issuer, tradeRegistryNumber: "", socialCapital: "", bankName: "", iban: "" }),
    ["Formă juridică: SRL", "Plătitor de TVA"])
  const longDetails = { ...invoice, issuer: { ...invoice.issuer, tradeRegistryNumber: "J".repeat(32),
    bankName: "Bancă foarte lungă ".repeat(7).slice(0, 120), iban: "RO49" + "A".repeat(30) } }
  const rendered = await Effect.runPromise(createPdfRenderer().render(longDetails))
  assert.ok((await PDFDocument.load(rendered.bytes, { updateMetadata: false })).getPageCount() >= 1)
})

void test("labels the frozen issuer VAT status for SRL and PFA without inventing an exemption", async () => {
  for (const legalForm of ["srl", "pfa"] as const) {
    for (const vatRegistered of [true, false]) {
      const issuer = { ...invoice.issuer, legalForm, vatRegistered, socialCapital: legalForm === "pfa" ? "" : "1000.00" }
      const lines = issuerLegalLines(issuer)
      assert.equal(lines[1], vatRegistered ? "Plătitor de TVA" : "Neplătitor de TVA")
      assert.equal(lines.some((line) => /scutit|scutire|\b310\b/i.test(line)), false)
      assert.equal(lines.some((line) => line.startsWith("Capital social:")), legalForm === "srl")
      // Even with zero VAT, the renderer must use only the snapshot flag.
      const rendered = await Effect.runPromise(createPdfRenderer().render({ ...invoice, issuer,
        vatTotal: "0.00", lines: invoice.lines.map((line) => ({ ...line, vatRate: "0.00", vatCategoryCode: "O",
          vatExemptionReason: article310VatExemptionReason, vatAmount: "0.00" })) }))
      assert.equal((await PDFDocument.load(rendered.bytes, { updateMetadata: false })).getPageCount(), 1)
    }
  }
})

void test("renders an individual buyer with a CNP label and omits an empty identifier", async () => {
  const individual = { ...invoice.customer, partyType: "individual" as const, vatRegistered: false, name: "Ion Popescu", fiscalIdentifier: "1800101221144" }
  assert.equal(partyIdentifierLine(individual), "CNP: 1800101221144")
  assert.equal(partyIdentifierLine({ ...individual, fiscalIdentifier: "" }), undefined)
  assert.equal(partyIdentifierLine(invoice.issuer), "CUI: 12345674 · Cod TVA: RO12345674")
  assert.equal(partyIdentifierLine({ ...invoice.issuer, vatRegistered: false }), "CUI: 12345674")
  assert.equal(partyIdentifierLine(invoice.customer), "CUI: 87654329 · Cod TVA: RO87654329")
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
      { ...base, description: "Transport", vatRate: "5.00", vatAmount: "5.00" },
    ],
    vatBreakdown: [
      { rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "100.00", vatAmount: "21.00" },
      { rate: "11.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "100.00", vatAmount: "11.00" },
      { rate: "5.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "100.00", vatAmount: "5.00" },
    ],
  }
  const rendered = await Effect.runPromise(createPdfRenderer().render(multiRate))
  const parsed = await PDFDocument.load(rendered.bytes, { updateMetadata: false })
  assert.equal(parsed.getPageCount(), 1)
})

/** An Article 310 document has no taxed line to sit beside: the whole document
 * is category `O`, the seller is not VAT registered, and the PDF must say
 * "Scutit" rather than a rate of zero — the two mean different things to a
 * reader, and only one of them is what this seller is allowed to claim. */
const article310Invoice: RenderableInvoice = {
  ...invoice,
  issuer: { ...invoice.issuer, vatRegistered: false },
  lines: invoice.lines.map((line) => ({
    ...line, vatRate: "0.00", vatCategoryCode: "O", vatExemptionReason: article310VatExemptionReason,
    vatAmount: "0.00", totalIncludingVat: line.totalExcludingVat,
  })),
  vatBreakdown: [{ rate: "0.00", vatCategoryCode: "O", vatExemptionReason: article310VatExemptionReason,
    vatBaseAmount: "100.00", vatAmount: "0.00" }],
  vatTotal: "0.00",
  totalIncludingVat: "100.00",
}

void test("renders an article 310 invoice and proforma as exempt rather than zero rated", async () => {
  const renderer = createPdfRenderer()
  const rendered = await Effect.runPromise(renderer.render(article310Invoice))
  assert.deepEqual(rendered.bytes, (await Effect.runPromise(renderer.render(article310Invoice))).bytes)
  assert.equal((await PDFDocument.load(rendered.bytes, { updateMetadata: false })).getPageCount(), 1)

  // The exempt wording, the summary label and the REGIM TVA block all hang off
  // the category. Rendering the same document as a taxed zero rate must produce
  // different bytes: were a branch left on the old category, these would match.
  const asZeroRated = await Effect.runPromise(renderer.render({
    ...article310Invoice,
    lines: article310Invoice.lines.map((line) => ({ ...line, vatCategoryCode: "S" as const, vatExemptionReason: null })),
    vatBreakdown: [{ rate: "0.00", vatCategoryCode: "S", vatExemptionReason: null,
      vatBaseAmount: "100.00", vatAmount: "0.00" }],
  }))
  assert.notDeepEqual(rendered.bytes, asZeroRated.bytes)

  const proforma: RenderableProforma = { ...article310Invoice, id: "proforma-310", sourceDraftId: null,
    convertedDraftId: null, convertedInvoiceId: null }
  const offer = await Effect.runPromise(renderer.renderProforma(proforma))
  assert.equal(offer.templateVersion, proformaTemplateVersion)
  assert.equal((await PDFDocument.load(offer.bytes, { updateMetadata: false })).getPageCount(), 1)
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

  const maximum = await Effect.runPromise(renderer.render({ ...invoice, notes: "ș".repeat(300) }))
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
    ...invoice, id: "proforma-1", sourceDraftId: null,
    convertedDraftId: null, convertedInvoiceId: null, notes: "Ofertă valabilă 30 de zile.",
  }
  const rendered = await Effect.runPromise(renderer.renderProforma(proforma))
  assert.equal(rendered.templateVersion, proformaTemplateVersion)
  const withoutNotes = await Effect.runPromise(renderer.renderProforma({ ...proforma, notes: null }))
  assert.ok(rendered.bytes.length > withoutNotes.bytes.length)
  assert.equal((await PDFDocument.load(rendered.bytes, { updateMetadata: false })).getPageCount(), 1)
})
