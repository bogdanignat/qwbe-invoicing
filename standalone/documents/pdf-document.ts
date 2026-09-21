import fontkit from "@pdf-lib/fontkit"
import { PDFDocument } from "pdf-lib"

import { type RenderableDocument } from "./pdf-format.ts"
import { contentTop, pageHeight, pageWidth, type Fonts } from "./pdf-layout.ts"
import { bottomLimit, type Sheet, addPage } from "./pdf-document-layout.ts"
import { drawHeader } from "./pdf-header.ts"
import { drawDocumentNotes, drawFooters, drawProformaNotice } from "./pdf-notes.ts"
import { drawTotals } from "./pdf-summary.ts"
import { drawTableHeader, drawTableRow } from "./pdf-table.ts"

export const renderPdf = async (
  document: RenderableDocument,
  fonts: { readonly regular: Uint8Array; readonly bold: Uint8Array },
  kind: "invoice" | "proforma",
  templateVersion: string,
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.registerFontkit(fontkit)
  const embedded: Fonts = {
    regular: await pdf.embedFont(fonts.regular, { subset: true, customName: "DejaVuSans" }),
    bold: await pdf.embedFont(fonts.bold, { subset: true, customName: "DejaVuSansBold" }),
  }
  const issuedAt = new Date(document.issuedAt)
  const isProforma = kind === "proforma"
  pdf.setTitle(`${isProforma ? "Proformă" : "Factura"} ${document.series} ${String(document.number)}`)
  pdf.setAuthor(document.issuer.name)
  pdf.setSubject(isProforma ? "PROFORMĂ — DOCUMENT NEFISCAL" : "Factură")
  pdf.setCreator("QWBE Invoicing")
  pdf.setProducer(`QWBE Invoicing ${templateVersion}`)
  pdf.setCreationDate(issuedAt)
  pdf.setModificationDate(issuedAt)
  const sheet: Sheet = { document: pdf, fonts: embedded, page: pdf.addPage([pageWidth, pageHeight]), y: contentTop }
  const brandImage = document.issuer.branding === null ? null : document.issuer.branding.image
  const image = brandImage === null ? null : await pdf.embedPng(brandImage.pngBase64)
  drawHeader(sheet, document, isProforma, image)
  drawTableHeader(sheet)
  document.lines.forEach((line, index) => { drawTableRow(sheet, line, index) })
  const summaryHeight = 62 + document.vatBreakdown.length * 11
  if (sheet.y - summaryHeight < bottomLimit) addPage(sheet)
  sheet.y -= 14
  const summaryTop = sheet.y
  drawTotals(sheet, document, isProforma)
  const noticeBottom = drawProformaNotice(sheet, summaryTop, isProforma)
  sheet.y = Math.min(sheet.y, noticeBottom)
  const exemptionReason = document.vatBreakdown.find(({ vatCategoryCode }) => vatCategoryCode === "O")?.vatExemptionReason ?? null
  drawDocumentNotes(sheet, exemptionReason, sheet.y - 14, "REGIM TVA")
  drawDocumentNotes(sheet, document.notes, sheet.y - 14)
  drawFooters(sheet, isProforma)
  return pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
}
