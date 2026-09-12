import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"
import { PDFDocument } from "pdf-lib"
import sharp from "sharp"

import type { RenderableInvoice, RenderableProforma } from "../cube/invoicing/documents/index.ts"
import { createPdfRenderer } from "./pdf-renderer.ts"

const invoice: RenderableInvoice = {
  id: "brand-invoice", organizationId: "org", series: "F", number: 1,
  issueDate: "2026-09-10", dueDate: null, issuedAt: "2026-09-10T10:00:00Z", currency: "RON", notes: null,
  issuer: { name: "Legal Issuer SRL", fiscalIdentifier: "RO12345674", address: { countryCode: "RO", city: "Iași", street: "Strada 1" },
    legalForm: "srl", tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000",
    bankName: "Banca Română", socialCapital: "1000.00", branding: null },
  customer: { name: "Client SRL", fiscalIdentifier: "RO87654329", partyType: "company", address: { countryCode: "RO", city: "Iași", street: "Strada 2" } },
  lines: [{ description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: { code: "HUR", name: "oră" }, vatRate: "21", totalExcludingVat: "100", vatAmount: "21", totalIncludingVat: "121" }],
  vatBreakdown: [{ rate: "21", vatBaseAmount: "100", vatAmount: "21" }], totalExcludingVat: "100", vatTotal: "21", totalIncludingVat: "121",
}

void test("renders none, custom text, image and both deterministically in invoice and proforma PDFs", async () => {
  const pngBase64 = (await sharp({ create: { width: 64, height: 32, channels: 3, background: "blue" } }).png().toBuffer()).toString("base64")
  const image = { pngBase64, width: 64, height: 32 }
  const renderer = createPdfRenderer()
  const text = "Știință & Tehnică — " + "Brand".repeat(10)
  const outputs = new Set<string>()
  for (const branding of [null, { text, image: null }, { text: null, image }, { text, image }]) {
    const source = { ...invoice, issuer: { ...invoice.issuer, branding } }
    const proforma: RenderableProforma = { ...source, sourceDraftId: null, invoiceSeries: "F", convertedDraftId: null, convertedInvoiceId: null }
    for (const [render, version] of [[() => renderer.render(source), "invoice-v6"], [() => renderer.renderProforma(proforma), "proforma-v5"]] as const) {
      const first = await Effect.runPromise(render())
      assert.equal(first.templateVersion, version)
      assert.deepEqual(first.bytes, (await Effect.runPromise(render())).bytes)
      const parsed = await PDFDocument.load(first.bytes)
      assert.equal(parsed.getPageCount(), 1)
      assert.equal(parsed.getAuthor(), invoice.issuer.name, "brand text must not replace legal issuer")
      const contents = Buffer.from(first.bytes).toString("latin1")
      assert.equal((contents.match(/\/Subtype \/Image\b/g) ?? []).length, branding?.image === image ? 1 : 0)
      outputs.add(Buffer.from(first.bytes).toString("base64"))
    }
  }
  assert.equal(outputs.size, 8, "every requested combination must affect the rendered document")
})

void test("keeps extreme-aspect branding and maximum text within a multipage invoice", async () => {
  const renderer = createPdfRenderer()
  for (const [width, height] of [[2048, 1], [1, 2048]] as const) {
    const pngBase64 = (await sharp({ create: { width, height, channels: 3, background: "blue" } }).png().toBuffer()).toString("base64")
    const base = invoice.lines[0]
    assert.ok(base)
    const result = await Effect.runPromise(renderer.render({
      ...invoice, issuer: { ...invoice.issuer, branding: { text: "Ș".repeat(80), image: { pngBase64, width, height } } },
      lines: Array.from({ length: 70 }, (_, index) => ({ ...base, description: `Poziția ${String(index + 1)} — servicii` })),
    }))
    assert.ok((await PDFDocument.load(result.bytes)).getPageCount() > 1)
    assert.equal((Buffer.from(result.bytes).toString("latin1").match(/\/Subtype \/Image\b/g) ?? []).length, 1)
  }
})
