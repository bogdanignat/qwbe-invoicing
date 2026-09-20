import { formatAmount, formatRate, type RenderableDocument } from "./pdf-format.ts"
import { contentRight, horizontalRule, ink, muted, paper, putText, rule, type Fonts } from "./pdf-layout.ts"
import type { Sheet } from "./pdf-document-layout.ts"

const fittingSize = (font: Fonts["bold"], text: string, available: number): number => {
  for (let size = 11.5; size > 8; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= available) return size
  }
  return 8
}

export const drawTotals = (sheet: Sheet, document: RenderableDocument, isProforma: boolean): void => {
  const width = 190
  const x = contentRight - width
  const money = (value: string): string => `${formatAmount(value)} ${document.currency}`
  let cursor = sheet.y
  const row = (label: string, value: string, options: { readonly bold?: boolean; readonly small?: boolean } = {}): void => {
    const size = options.small === true ? 7.5 : 8.5
    const font = options.bold === true ? sheet.fonts.bold : sheet.fonts.regular
    putText(sheet.page, label, { x: options.small === true ? x + 8 : x, y: cursor, size,
      font: sheet.fonts.regular, color: options.small === true ? muted : ink })
    putText(sheet.page, value, { x, y: cursor, size, font, align: "right", width })
    cursor -= options.small === true ? 11 : 13
  }
  row("Total fără TVA", money(document.totalExcludingVat))
  for (const vat of document.vatBreakdown) {
    const label = vat.vatCategoryCode === "O" ? "Scutit TVA (art. 310)" : `TVA ${formatRate(vat.rate)}% din ${formatAmount(vat.vatBaseAmount)}`
    row(label, formatAmount(vat.vatAmount), { small: true })
  }
  horizontalRule(sheet.page, cursor + 7, { color: rule })
  cursor -= 3
  row("Total TVA", money(document.vatTotal))
  const boxTop = cursor - 2
  const boxHeight = 26
  sheet.page.drawRectangle({ x, y: boxTop - boxHeight, width, height: boxHeight, color: ink })
  const grandLabel = isProforma ? "TOTAL PROFORMĂ" : "TOTAL DE PLATĂ"
  const grandValue = money(document.totalIncludingVat)
  const available = width - sheet.fonts.bold.widthOfTextAtSize(grandLabel, 7.5) - 28
  putText(sheet.page, grandLabel, { x: x + 10, y: boxTop - 17, size: 7.5, font: sheet.fonts.bold, color: paper })
  putText(sheet.page, grandValue, { x, y: boxTop - 18, size: fittingSize(sheet.fonts.bold, grandValue, available),
    font: sheet.fonts.bold, color: paper, align: "right", width: width - 10 })
  sheet.y = boxTop - boxHeight
}
