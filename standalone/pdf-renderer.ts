import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import fontkit from "@pdf-lib/fontkit"
import { Effect } from "effect"
import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib"

import {
  DocumentRenderingFailure,
  type InvoiceRenderer,
  type RenderableInvoice,
} from "../cube/invoicing/documents/index.ts"

export const invoiceTemplateVersion = "invoice-v1"
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

const partyLines = (label: string, party: RenderableInvoice["issuer"]): ReadonlyArray<string> => [
  label,
  party.legalName,
  `CUI: ${party.taxIdentifier}`,
  `${party.address.street}, ${party.address.city}`,
  [party.address.county, party.address.postalCode, party.address.countryCode].filter(Boolean).join(", "),
]

export const renderInvoicePdf = async (
  invoice: RenderableInvoice,
  fontBytes: Uint8Array,
): Promise<Uint8Array> => {
  const document = await PDFDocument.create({ updateMetadata: false })
  document.registerFontkit(fontkit)
  const font = await document.embedFont(fontBytes, { subset: true, customName: "DejaVuSans" })
  const issuedAt = new Date(invoice.issuedAt)
  const label = `Factura ${invoice.series} ${String(invoice.number)}`
  document.setTitle(label)
  document.setAuthor(invoice.issuer.legalName)
  document.setSubject("Factură")
  document.setCreator("QWBE Invoicing")
  document.setProducer(`QWBE Invoicing ${invoiceTemplateVersion}`)
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
  draw(layout, "FACTURĂ", { size: 22, bold: true })
  draw(layout, `${invoice.series} nr. ${String(invoice.number)}`, { size: 13 })
  draw(layout, `Data emiterii: ${invoice.issueDate}   Scadență: ${invoice.dueDate}`)
  draw(layout, `Monedă: ${invoice.currency}`)
  space(layout, 12)

  for (const line of partyLines("FURNIZOR", invoice.issuer)) draw(layout, line, { width: pageWidth - margin * 2 })
  space(layout, 8)
  for (const line of partyLines("CLIENT", invoice.customer)) draw(layout, line, { width: pageWidth - margin * 2 })
  space(layout, 18)

  draw(layout, "POZIȚII FACTURĂ", { size: 12, bold: true })
  invoice.lines.forEach((line, index) => {
    draw(layout, `${String(index + 1)}. ${line.description}`, { bold: true })
    draw(layout,
      `${line.quantity} × ${line.unitPrice} | bază ${line.totalExcludingTax} | TVA ${line.taxRate}%: ${line.taxAmount} | total ${line.totalIncludingTax}`,
      { size: 9 },
    )
    space(layout, 6)
  })

  space(layout, 8)
  draw(layout, "SUMAR TVA", { size: 12, bold: true })
  invoice.taxBreakdown.forEach((tax) => {
    draw(layout, `TVA ${tax.rate}% | bază ${tax.taxableAmount} | taxă ${tax.taxAmount}`)
  })
  space(layout, 8)
  draw(layout, `TOTAL FĂRĂ TVA: ${invoice.totalExcludingTax} ${invoice.currency}`, { bold: true })
  draw(layout, `TVA: ${invoice.taxTotal} ${invoice.currency}`, { bold: true })
  draw(layout, `TOTAL DE PLATĂ: ${invoice.totalIncludingTax} ${invoice.currency}`, { size: 14, bold: true })

  return document.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
}

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
  }
}
