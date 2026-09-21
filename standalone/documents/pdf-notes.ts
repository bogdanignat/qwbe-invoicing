import { accent, contentTop, contentWidth, horizontalRule, margin, muted, noteFill, putLines, putText, warning, wrapText } from "./pdf-layout.ts"
import { addPage, bottomLimit, type Sheet } from "./pdf-document-layout.ts"

export const drawProformaNotice = (sheet: Sheet, top: number, isProforma: boolean): number => {
  if (!isProforma) return top
  const width = contentWidth - 202
  const lines = wrapText(sheet.fonts.regular, 8, width - 16,
    "Document nefiscal. Proforma nu generează obligații de plată a TVA și nu înlocuiește factura fiscală.")
  const height = lines.length * 11 + 22
  sheet.page.drawRectangle({ x: margin, y: top - height, width, height, color: noteFill })
  sheet.page.drawRectangle({ x: margin, y: top - height, width: 2.5, height, color: warning })
  const cursor = putLines(sheet.page, ["MENȚIUNE LEGALĂ"], { x: margin + 10, width: width - 16,
    top: top - 12, size: 6.5, font: sheet.fonts.bold, color: muted, leading: 11 })
  putLines(sheet.page, lines, { x: margin + 10, width: width - 16, top: cursor,
    size: 8, font: sheet.fonts.regular, leading: 11 })
  return top - height
}

export const drawDocumentNotes = (sheet: Sheet, notes: string | null, top: number, title = "OBSERVAȚII"): void => {
  if (notes === null) return
  const innerWidth = contentWidth - 20
  let remaining = wrapText(sheet.fonts.regular, 8, innerWidth, notes)
  let blockTop = top
  while (remaining.length > 0) {
    const capacity = Math.floor((blockTop - bottomLimit - 22) / 11)
    if (capacity < 1) {
      addPage(sheet)
      blockTop = contentTop
      continue
    }
    const chunk = remaining.slice(0, capacity)
    remaining = remaining.slice(capacity)
    const height = chunk.length * 11 + 22
    sheet.page.drawRectangle({ x: margin, y: blockTop - height, width: contentWidth, height, color: noteFill })
    sheet.page.drawRectangle({ x: margin, y: blockTop - height, width: 2.5, height, color: accent })
    const cursor = putLines(sheet.page, [title], { x: margin + 10, width: innerWidth, top: blockTop - 12,
      size: 6.5, font: sheet.fonts.bold, color: muted, leading: 11 })
    putLines(sheet.page, chunk, { x: margin + 10, width: innerWidth, top: cursor,
      size: 8, font: sheet.fonts.regular, leading: 11 })
    sheet.y = blockTop - height
    blockTop = sheet.y - 14
  }
}

export const drawFooters = (sheet: Sheet, isProforma: boolean): void => {
  const pages = sheet.document.getPages()
  const total = pages.length
  pages.forEach((page, index) => {
    horizontalRule(page, margin + 30)
    putText(page, isProforma ? "Proformă — document nefiscal, generat electronic."
      : "Document generat electronic, valabil fără semnătură și ștampilă.", {
      x: margin, y: margin + 18, size: 7, font: sheet.fonts.regular, color: muted,
    })
    putText(page, `Pagina ${String(index + 1)} din ${String(total)} · QWBE Invoicing`, {
      x: margin, y: margin + 18, size: 7, font: sheet.fonts.regular, color: muted,
      align: "right", width: contentWidth,
    })
  })
}
