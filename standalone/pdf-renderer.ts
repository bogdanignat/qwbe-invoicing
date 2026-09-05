import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import fontkit from "@pdf-lib/fontkit"
import { Effect } from "effect"
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib"

import {
  DocumentRenderingFailure,
  type InvoiceRenderer,
  type RenderableInvoice,
  type RenderableParty,
  type RenderableProforma,
} from "../cube/invoicing/documents/index.ts"

export const invoiceTemplateVersion = "invoice-v2"
export const proformaTemplateVersion = "proforma-v1"
const defaultFontPath = fileURLToPath(new URL("./assets/fonts/DejaVuSans.ttf", import.meta.url))
const pageWidth = 595.28
const pageHeight = 841.89
const margin = 42
const lineHeight = 16

interface Layout {
  readonly document: PDFDocument
  readonly font: PDFFont
  readonly continuationLabel: string
  page: PDFPage
  y: number
  pageNumber: number
}

const wrap = (font: PDFFont, text: string, size: number, width: number): ReadonlyArray<string> => {
  const lines: Array<string> = []
  let current = ""
  for (const character of Array.from(text)) {
    const candidate = `${current}${character}`
    if (current.length === 0 || font.widthOfTextAtSize(candidate, size) <= width) {
      current = candidate
    } else {
      lines.push(current.trimEnd())
      current = character === " " ? "" : character
    }
  }
  if (current.length > 0) lines.push(current.trimEnd())
  return lines.length === 0 ? [""] : lines
}

const nextPage = (layout: Layout) => {
  layout.page = layout.document.addPage([pageWidth, pageHeight])
  layout.pageNumber += 1
  layout.y = pageHeight - margin
  if (layout.pageNumber > 1) {
    layout.page.drawText(`${layout.continuationLabel} — continuare`, {
      x: margin,
      y: layout.y,
      size: 9,
      font: layout.font,
      color: rgb(0.3, 0.3, 0.3),
    })
    layout.y -= lineHeight * 1.5
  }
}

const draw = (layout: Layout, text: string, options: {
  readonly size?: number
  readonly x?: number
  readonly width?: number
  readonly bold?: boolean
} = {}) => {
  const size = options.size ?? 10
  const x = options.x ?? margin
  const width = options.width ?? pageWidth - margin * 2
  for (const line of wrap(layout.font, text, size, width)) {
    if (layout.y - lineHeight < margin) nextPage(layout)
    layout.page.drawText(line, {
      x,
      y: layout.y,
      size,
      font: layout.font,
      color: options.bold === true ? rgb(0.05, 0.15, 0.3) : rgb(0.1, 0.1, 0.1),
    })
    layout.y -= lineHeight
  }
}

const space = (layout: Layout, height: number) => {
  if (layout.y - height < margin) nextPage(layout)
  else layout.y -= height
}

export const partyIdentifierLine = (party: RenderableParty): string | undefined => party.fiscalIdentifier === ""
  ? undefined
  : `${party.partyType === "individual" ? "CNP" : "CUI"}: ${party.fiscalIdentifier}`

export const documentDateLine = (document: Pick<RenderableDocument, "issueDate" | "dueDate">): string =>
  `Data emiterii: ${document.issueDate}${document.dueDate === null ? "" : `   Scadență: ${document.dueDate}`}`

const partyLines = (label: string, party: RenderableParty): ReadonlyArray<string> => {
  const identifier = partyIdentifierLine(party)
  return [label, party.name, ...(identifier === undefined ? [] : [identifier]),
    `${party.address.street}, ${party.address.city}`,
    [party.address.county, party.address.postalCode, party.address.countryCode].filter(Boolean).join(", ")]
}

type RenderableDocument = RenderableInvoice | RenderableProforma

const renderPdf = async (
  invoice: RenderableDocument,
  fontBytes: Uint8Array,
  kind: "invoice" | "proforma",
): Promise<Uint8Array> => {
  const document = await PDFDocument.create({ updateMetadata: false })
  document.registerFontkit(fontkit)
  const font = await document.embedFont(fontBytes, { subset: true, customName: "DejaVuSans" })
  const issuedAt = new Date(invoice.issuedAt)
  const isProforma = kind === "proforma"
  const label = `${isProforma ? "Proformă" : "Factura"} ${invoice.series} ${String(invoice.number)}`
  const templateVersion = isProforma ? proformaTemplateVersion : invoiceTemplateVersion
  document.setTitle(label)
  document.setAuthor(invoice.issuer.name)
  document.setSubject(isProforma ? "PROFORMĂ — DOCUMENT NEFISCAL" : "Factură")
  document.setCreator("QWBE Invoicing")
  document.setProducer(`QWBE Invoicing ${templateVersion}`)
  document.setCreationDate(issuedAt)
  document.setModificationDate(issuedAt)

  const layout: Layout = {
    document,
    font,
    continuationLabel: label,
    page: document.addPage([pageWidth, pageHeight]),
    y: pageHeight - margin,
    pageNumber: 1,
  }
  draw(layout, isProforma ? "PROFORMĂ" : "FACTURĂ", { size: 22, bold: true })
  if (isProforma) draw(layout, "DOCUMENT NEFISCAL", { size: 15, bold: true })
  draw(layout, `${invoice.series} nr. ${String(invoice.number)}`, { size: 13 })
  draw(layout, documentDateLine(invoice))
  draw(layout, `Monedă: ${invoice.currency}`)
  space(layout, 12)

  for (const line of partyLines("FURNIZOR", invoice.issuer)) draw(layout, line, { width: pageWidth - margin * 2 })
  space(layout, 8)
  for (const line of partyLines("CLIENT", invoice.customer)) draw(layout, line, { width: pageWidth - margin * 2 })
  space(layout, 18)

  draw(layout, isProforma ? "POZIȚII PROFORMĂ" : "POZIȚII FACTURĂ", { size: 12, bold: true })
  invoice.lines.forEach((line, index) => {
    draw(layout, `${String(index + 1)}. ${line.description}`, { bold: true })
    draw(layout,
      `${line.quantity} ${line.unitOfMeasure.name} (${line.unitOfMeasure.code}) × ${line.unitPrice} | bază ${line.totalExcludingVat} | TVA ${line.vatRate}%: ${line.vatAmount} | total ${line.totalIncludingVat}`,
      { size: 9 },
    )
    space(layout, 6)
  })

  space(layout, 8)
  draw(layout, "SUMAR TVA", { size: 12, bold: true })
  invoice.vatBreakdown.forEach((vat) => {
    draw(layout, `TVA ${vat.rate}% | bază ${vat.vatBaseAmount} | taxă ${vat.vatAmount}`)
  })
  space(layout, 8)
  draw(layout, `TOTAL FĂRĂ TVA: ${invoice.totalExcludingVat} ${invoice.currency}`, { bold: true })
  draw(layout, `TVA: ${invoice.vatTotal} ${invoice.currency}`, { bold: true })
  draw(layout, `${isProforma ? "TOTAL PROFORMĂ" : "TOTAL DE PLATĂ"}: ${invoice.totalIncludingVat} ${invoice.currency}`, { size: 14, bold: true })

  return document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
}

export const renderInvoicePdf = async (invoice: RenderableInvoice, fontBytes: Uint8Array): Promise<Uint8Array> =>
  renderPdf(invoice, fontBytes, "invoice")

export const renderProformaPdf = async (proforma: RenderableProforma, fontBytes: Uint8Array): Promise<Uint8Array> =>
  renderPdf(proforma, fontBytes, "proforma")

export const createPdfRenderer = (fontPath = defaultFontPath): InvoiceRenderer => {
  const fontBytes = readFile(fontPath).then((bytes) => new Uint8Array(bytes))
  return {
    render: (invoice) => Effect.tryPromise({
      try: async () => ({
        bytes: await renderInvoicePdf(invoice, await fontBytes),
        mediaType: "application/pdf" as const,
        templateVersion: invoiceTemplateVersion,
      }),
      catch: () => new DocumentRenderingFailure({ template: invoiceTemplateVersion }),
    }),
    renderProforma: (proforma) => Effect.tryPromise({
      try: async () => ({
        bytes: await renderProformaPdf(proforma, await fontBytes),
        mediaType: "application/pdf" as const,
        templateVersion: proformaTemplateVersion,
      }),
      catch: () => new DocumentRenderingFailure({ template: proformaTemplateVersion }),
    }),
  }
}
