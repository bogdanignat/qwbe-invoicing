import { formatAmount, formatRate, type RenderableLine } from "./pdf-format.ts"
import { contentWidth, headerFill, horizontalRule, ink, margin, muted, putLines, putText, wrapText } from "./pdf-layout.ts"
import { addPage, bottomLimit, columnOffsets, columns, type Sheet } from "./pdf-document-layout.ts"

export const drawTableHeader = (sheet: Sheet): void => {
  const top = sheet.y
  sheet.page.drawRectangle({ x: margin, y: top - 4, width: contentWidth, height: 16, color: headerFill })
  columns.forEach((column, index) => {
    putText(sheet.page, column.title.toLocaleUpperCase("ro-RO"), {
      x: columnOffsets[index] ?? margin,
      y: top,
      size: 6.5,
      font: sheet.fonts.bold,
      color: muted,
      align: column.align,
      width: column.width,
    })
  })
  horizontalRule(sheet.page, top - 4, { thickness: 1, color: ink })
  sheet.y = top - 16
}

const unitLabel = (sheet: Sheet, unit: RenderableLine["unitOfMeasure"]): string =>
  sheet.fonts.regular.widthOfTextAtSize(unit.name, 8) <= (columns[3]?.width ?? 42) - 6 ? unit.name : unit.code

export const drawTableRow = (sheet: Sheet, line: RenderableLine, index: number): void => {
  const descriptionColumn = columns[1]?.width ?? 187
  const description = wrapText(sheet.fonts.bold, 8, descriptionColumn, line.description)
  const height = Math.max(description.length * 10, 10) + 8
  if (sheet.y - height < bottomLimit) {
    addPage(sheet)
    drawTableHeader(sheet)
  }
  const top = sheet.y
  const cells: ReadonlyArray<string> = [
    String(index + 1), "", formatAmount(line.quantity), unitLabel(sheet, line.unitOfMeasure),
    formatAmount(line.unitPrice), formatAmount(line.totalExcludingVat),
    line.vatCategoryCode === "O" ? "Scutit" : `${formatRate(line.vatRate)}%`, formatAmount(line.vatAmount),
  ]
  cells.forEach((value, cellIndex) => {
    if (value === "") return
    const column = columns[cellIndex]
    if (column === undefined) return
    putText(sheet.page, value, { x: columnOffsets[cellIndex] ?? margin, y: top, size: 8,
      font: sheet.fonts.regular, color: cellIndex === 0 ? muted : ink, align: column.align, width: column.width })
  })
  putLines(sheet.page, description, { x: columnOffsets[1] ?? margin, width: descriptionColumn,
    top, size: 8, font: sheet.fonts.bold, leading: 10 })
  horizontalRule(sheet.page, top - height + 6)
  sheet.y = top - height
}
