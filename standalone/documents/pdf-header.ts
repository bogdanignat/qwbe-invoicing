import type { PDFImage } from "pdf-lib"
import type { RenderableParty } from "../../cube/invoicing/documents/index.ts"

import { issuerLegalLines, partyAddressLines, partyIdentifierLine, type RenderableDocument } from "./pdf-format.ts"
import { accent, contentRight, contentTop, horizontalRule, ink, margin, muted, putLines, putText, warning, wrapText } from "./pdf-layout.ts"
import type { Sheet } from "./pdf-document-layout.ts"

const logoSize = 44
const headerLeftX = margin
const headerLeftWidth = 168
const headerMidX = margin + 176
const headerMidWidth = 158
const headerRightX = margin + 342
const headerRightWidth = contentRight - headerRightX

const drawBrand = (sheet: Sheet, branding: RenderableDocument["issuer"]["branding"], image: PDFImage | null): number => {
  if (branding === null) return sheet.y
  let cursor = sheet.y
  if (image !== null) {
    const scale = Math.min(headerLeftWidth / image.width, logoSize / image.height)
    const width = image.width * scale
    const height = image.height * scale
    sheet.page.drawImage(image, { x: headerLeftX, y: cursor - height, width, height })
    cursor -= height + 14
  }
  if (branding.text !== null) {
    cursor = putLines(sheet.page, wrapText(sheet.fonts.bold, 11, headerLeftWidth, branding.text), {
      x: headerLeftX, top: cursor, width: headerLeftWidth, size: 11, leading: 13, font: sheet.fonts.bold,
    }) - 10
  }
  return cursor
}

const drawPartyColumn = (
  sheet: Sheet,
  party: RenderableParty,
  options: { readonly label: string; readonly x: number; readonly width: number; readonly top: number;
    readonly align: "left" | "right"; readonly details?: ReadonlyArray<string> },
): number => {
  const shared = { x: options.x, width: options.width, align: options.align }
  let cursor = putLines(sheet.page, [options.label], {
    ...shared, top: options.top, size: 6.5, font: sheet.fonts.bold, color: muted, leading: 11,
  })
  cursor = putLines(sheet.page, wrapText(sheet.fonts.bold, 10, options.width, party.name), {
    ...shared, top: cursor, size: 10, font: sheet.fonts.bold, leading: 12,
  })
  const identifier = partyIdentifierLine(party)
  if (identifier !== undefined) {
    cursor = putLines(sheet.page, wrapText(sheet.fonts.regular, 8, options.width, identifier), {
      ...shared, top: cursor - 1, size: 8, font: sheet.fonts.regular, leading: 11,
    })
  }
  if (options.details !== undefined) {
    const details = options.details.flatMap((line) => wrapText(sheet.fonts.regular, 7.5, options.width, line))
    cursor = putLines(sheet.page, details, { ...shared, top: cursor, size: 7.5, font: sheet.fonts.regular, leading: 9.5 })
  }
  const address = partyAddressLines(party).flatMap((line) => wrapText(sheet.fonts.regular, 8, options.width, line))
  return putLines(sheet.page, address, {
    ...shared, top: cursor, size: 8, font: sheet.fonts.regular, color: ink, leading: 10.5,
  })
}

const drawDocumentColumn = (sheet: Sheet, document: RenderableDocument, isProforma: boolean): number => {
  const shared = { x: headerMidX, width: headerMidWidth, align: "center" as const }
  let cursor = putLines(sheet.page, [isProforma ? "PROFORMĂ" : "FACTURĂ"], {
    ...shared, top: contentTop - 14, size: 19, font: sheet.fonts.bold, leading: 20,
  })
  if (isProforma) {
    cursor = putLines(sheet.page, ["DOCUMENT NEFISCAL"], {
      ...shared, top: cursor + 4, size: 7.5, font: sheet.fonts.bold, color: warning, leading: 12,
    })
  }
  cursor = putLines(sheet.page, [`${document.series} ${String(document.number)}`], {
    ...shared, top: cursor + 2, size: 10.5, font: sheet.fonts.bold, color: accent, leading: 18,
  })
  const rows: ReadonlyArray<readonly [string, string, boolean]> = [
    ["Data emiterii", document.issueDate, false],
    ...(document.dueDate === null ? [] : [["Scadență", document.dueDate, true] as const]),
    ["Monedă", document.currency, false],
  ]
  for (const [label, value, emphasised] of rows) {
    putText(sheet.page, label, { x: headerMidX, y: cursor, size: 8, font: sheet.fonts.regular, color: muted })
    putText(sheet.page, value, { x: headerMidX, y: cursor, size: 8,
      font: emphasised ? sheet.fonts.bold : sheet.fonts.regular, color: emphasised ? warning : ink,
      align: "right", width: headerMidWidth })
    cursor -= 11
  }
  return cursor
}

export const drawHeader = (sheet: Sheet, document: RenderableDocument, isProforma: boolean, image: PDFImage | null): void => {
  const afterLogo = drawBrand(sheet, document.issuer.branding, image)
  const leftBottom = drawPartyColumn(sheet, document.issuer, { label: "FURNIZOR", x: headerLeftX,
    width: headerLeftWidth, top: afterLogo, align: "left", details: issuerLegalLines(document.issuer) })
  const midBottom = drawDocumentColumn(sheet, document, isProforma)
  const rightBottom = drawPartyColumn(sheet, document.customer, { label: "CLIENT", x: headerRightX,
    width: headerRightWidth, top: afterLogo, align: "right" })
  const bottom = Math.min(leftBottom, midBottom, rightBottom) - 6
  horizontalRule(sheet.page, bottom, { thickness: 1.2, color: ink })
  sheet.y = bottom - 22
}
