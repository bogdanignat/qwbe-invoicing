import type { PDFDocument, PDFPage } from "pdf-lib"

import { contentTop, margin, pageHeight, pageWidth, type Fonts } from "./pdf-layout.ts"

export interface Sheet {
  readonly document: PDFDocument
  readonly fonts: Fonts
  page: PDFPage
  y: number
}

export interface Column {
  readonly title: string
  readonly width: number
  readonly align: "left" | "center" | "right"
}

export const columns: ReadonlyArray<Column> = [
  { title: "#", width: 18, align: "left" },
  { title: "Denumire", width: 187, align: "left" },
  { title: "Cant.", width: 44, align: "right" },
  { title: "UM", width: 42, align: "center" },
  { title: "Preț unitar", width: 62, align: "right" },
  { title: "Valoare", width: 62, align: "right" },
  { title: "TVA", width: 32, align: "center" },
  { title: "Valoare TVA", width: 64, align: "right" },
]

export const columnOffsets = columns.reduce<ReadonlyArray<number>>(
  (offsets, column) => [...offsets, (offsets[offsets.length - 1] ?? margin) + column.width],
  [margin],
)

export const bottomLimit = margin + 54

export const addPage = (sheet: Sheet): void => {
  sheet.page = sheet.document.addPage([pageWidth, pageHeight])
  sheet.y = contentTop
}
