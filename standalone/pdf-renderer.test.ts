import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"
import { PDFDocument } from "pdf-lib"

import type { RenderableInvoice, RenderableProforma } from "../cube/invoicing/documents/index.ts"
import { createPdfRenderer, documentDateLine, invoiceTemplateVersion, partyIdentifierLine, proformaTemplateVersion } from "./pdf-renderer.ts"

const invoice: RenderableInvoice = {
  id: "invoice-1",
  organizationId: "org-1",
  series: "QWBE",
  number: 7,
  issueDate: "2026-09-01",
  dueDate: "2026-09-16",
  issuedAt: "2026-09-01T10:00:00.000Z",
  currency: "RON",
  issuer: {
    legalName: "Știință și Tehnică SRL",
    taxIdentifier: "RO12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Independenței 1" },
  },
  customer: {
    partyType: "company",
    legalName: "Țesături România SRL",
    taxIdentifier: "RO87654329",
    address: { countryCode: "RO", city: "Iași", street: "Șoseaua Națională 2" },
  },
  lines: [{
    description: "Servicii de consultanță și analiză",
    quantity: "1.0000",
    unitPrice: "100.00",
    unitOfMeasure: { code: "HUR", name: "oră" },
    taxRate: "21.00",
    totalExcludingTax: "100.00",
    taxAmount: "21.00",
    totalIncludingTax: "121.00",
  }],
  taxBreakdown: [{ rate: "21.00", taxableAmount: "100.00", taxAmount: "21.00" }],
  totalExcludingTax: "100.00",
  taxTotal: "21.00",
  totalIncludingTax: "121.00",
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

void test("renders an individual buyer with a CNP label and omits an empty identifier", async () => {
  const individual = { ...invoice.customer, partyType: "individual" as const, legalName: "Ion Popescu", taxIdentifier: "1800101221144" }
  assert.equal(partyIdentifierLine(individual), "CNP: 1800101221144")
  assert.equal(partyIdentifierLine({ ...individual, taxIdentifier: "" }), undefined)
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
