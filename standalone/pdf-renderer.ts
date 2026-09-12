import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import fontkit from "@pdf-lib/fontkit"
import { Effect } from "effect"
import { PDFDocument, type PDFImage, type PDFPage } from "pdf-lib"

import {
  DocumentRenderingFailure,
  type InvoiceRenderer,
  type RenderableInvoice,
  type RenderableParty,
  type RenderableProforma,
} from "../cube/invoicing/documents/index.ts"
import {
  accent,
  contentRight,
  contentTop,
  contentWidth,
  type Fonts,
  headerFill,
  horizontalRule,
  ink,
  margin,
  muted,
  noteFill,
  pageHeight,
  pageWidth,
  paper,
  putLines,
  putText,
  rule,
  warning,
  wrapText,
} from "./pdf-layout.ts"

export const invoiceTemplateVersion = "invoice-v6"
export const proformaTemplateVersion = "proforma-v5"

const regularFontPath = fileURLToPath(new URL("./assets/fonts/DejaVuSans.ttf", import.meta.url))
const boldFontPath = fileURLToPath(new URL("./assets/fonts/DejaVuSans-Bold.ttf", import.meta.url))

const footerReserve = 54
const bottomLimit = margin + footerReserve
const logoSize = 44

const headerLeftX = margin
const headerLeftWidth = 168
const headerMidX = margin + 176
const headerMidWidth = 158
const headerRightX = margin + 342
const headerRightWidth = contentRight - headerRightX

interface Column {
  readonly title: string
  readonly width: number
  readonly align: "left" | "center" | "right"
}

const columns: ReadonlyArray<Column> = [
  { title: "#", width: 18, align: "left" },
  { title: "Denumire", width: 187, align: "left" },
  { title: "Cant.", width: 44, align: "right" },
  { title: "UM", width: 42, align: "center" },
  { title: "Preț unitar", width: 62, align: "right" },
  { title: "Valoare", width: 62, align: "right" },
  { title: "TVA", width: 32, align: "center" },
  { title: "Valoare TVA", width: 64, align: "right" },
]

const columnOffsets = columns.reduce<ReadonlyArray<number>>(
  (offsets, column) => [...offsets, (offsets[offsets.length - 1] ?? margin) + column.width],
  [margin],
)

/** Renders `1234.56` as `1.234,56`, leaving anything unrecognised untouched. */
export const formatAmount = (value: string): string => {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (match === null) return value
  const sign = match[1] ?? ""
  const whole = (match[2] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  const fraction = match[3]
  return fraction === undefined ? `${sign}${whole}` : `${sign}${whole},${fraction}`
}

/** Renders `21.00` as `21` and `20.50` as `20,5` for compact rate labels. */
export const formatRate = (rate: string): string => {
  if (!rate.includes(".")) return rate
  const stripped = rate.replace(/0+$/, "").replace(/\.$/, "")
  return formatAmount(stripped === "" ? "0" : stripped)
}

export const partyIdentifierLine = (party: RenderableParty): string | undefined => party.fiscalIdentifier === ""
  ? undefined
  : `${party.partyType === "individual" ? "CNP" : "CUI"}: ${party.fiscalIdentifier}`

export const documentDateLine = (document: Pick<RenderableDocument, "issueDate" | "dueDate">): string =>
  `Data emiterii: ${document.issueDate}${document.dueDate === null ? "" : `   Scadență: ${document.dueDate}`}`

const partyAddressLines = (party: RenderableParty): ReadonlyArray<string> => {
  const region = [party.address.county, party.address.postalCode].filter((part) => part !== undefined && part !== "")
  return [
    party.address.street,
    [party.address.city, ...region].filter((part) => part !== "").join(", "),
    party.address.countryCode,
  ].filter((line) => line !== "")
}

export const issuerLegalLines = (issuer: RenderableDocument["issuer"]): ReadonlyArray<string> => [
  `Formă juridică: ${issuer.legalForm.toUpperCase()}`,
  issuer.tradeRegistryNumber === "" ? "" : `Nr. registrul comerțului: ${issuer.tradeRegistryNumber}`,
  issuer.socialCapital === "" ? "" : `Capital social: ${formatAmount(issuer.socialCapital)} RON`,
  issuer.bankName === "" ? "" : `Bancă: ${issuer.bankName}`,
  issuer.iban === "" ? "" : `IBAN: ${issuer.iban}`,
].filter((line) => line !== "")

type RenderableDocument = RenderableInvoice | RenderableProforma
type RenderableLine = RenderableInvoice["lines"][number]

interface Sheet {
  readonly document: PDFDocument
  readonly fonts: Fonts
  page: PDFPage
  y: number
}

const addPage = (sheet: Sheet): void => {
  sheet.page = sheet.document.addPage([pageWidth, pageHeight])
  sheet.y = contentTop
}

/** Draws the frozen organization brand without replacing the legal party. */
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
  options: { readonly label: string; readonly x: number; readonly width: number; readonly top: number; readonly align: "left" | "right";
    readonly details?: ReadonlyArray<string> },
): number => {
  const shared = { x: options.x, width: options.width, align: options.align }
  let cursor = putLines(sheet.page, [options.label], {
    ...shared,
    top: options.top,
    size: 6.5,
    font: sheet.fonts.bold,
    color: muted,
    leading: 11,
  })
  cursor = putLines(sheet.page, wrapText(sheet.fonts.bold, 10, options.width, party.name), {
    ...shared,
    top: cursor,
    size: 10,
    font: sheet.fonts.bold,
    leading: 12,
  })
  const identifier = partyIdentifierLine(party)
  if (identifier !== undefined) {
    cursor = putLines(sheet.page, [identifier], {
      ...shared,
      top: cursor - 1,
      size: 8,
      font: sheet.fonts.regular,
      leading: 11,
    })
  }
  if (options.details !== undefined) {
    const details = options.details.flatMap((line) => wrapText(sheet.fonts.regular, 7.5, options.width, line))
    cursor = putLines(sheet.page, details, { ...shared, top: cursor, size: 7.5, font: sheet.fonts.regular, leading: 9.5 })
  }
  const address = partyAddressLines(party).flatMap((line) => wrapText(sheet.fonts.regular, 8, options.width, line))
  return putLines(sheet.page, address, {
    ...shared,
    top: cursor,
    size: 8,
    font: sheet.fonts.regular,
    color: ink,
    leading: 10.5,
  })
}

const drawDocumentColumn = (sheet: Sheet, document: RenderableDocument, isProforma: boolean): number => {
  const shared = { x: headerMidX, width: headerMidWidth, align: "center" as const }
  let cursor = putLines(sheet.page, [isProforma ? "PROFORMĂ" : "FACTURĂ"], {
    ...shared,
    top: contentTop - 14,
    size: 19,
    font: sheet.fonts.bold,
    leading: 20,
  })
  if (isProforma) {
    cursor = putLines(sheet.page, ["DOCUMENT NEFISCAL"], {
      ...shared,
      top: cursor + 4,
      size: 7.5,
      font: sheet.fonts.bold,
      color: warning,
      leading: 12,
    })
  }
  cursor = putLines(sheet.page, [`${document.series} ${String(document.number)}`], {
    ...shared,
    top: cursor + 2,
    size: 10.5,
    font: sheet.fonts.bold,
    color: accent,
    leading: 18,
  })
  const rows: ReadonlyArray<readonly [string, string, boolean]> = [
    ["Data emiterii", document.issueDate, false],
    ...(document.dueDate === null ? [] : [["Scadență", document.dueDate, true] as const]),
    ["Monedă", document.currency, false],
  ]
  for (const [label, value, emphasised] of rows) {
    putText(sheet.page, label, {
      x: headerMidX,
      y: cursor,
      size: 8,
      font: sheet.fonts.regular,
      color: muted,
    })
    putText(sheet.page, value, {
      x: headerMidX,
      y: cursor,
      size: 8,
      font: emphasised ? sheet.fonts.bold : sheet.fonts.regular,
      color: emphasised ? warning : ink,
      align: "right",
      width: headerMidWidth,
    })
    cursor -= 11
  }
  return cursor
}

const drawHeader = (sheet: Sheet, document: RenderableDocument, isProforma: boolean, image: PDFImage | null): void => {
  const afterLogo = drawBrand(sheet, document.issuer.branding, image)
  const leftBottom = drawPartyColumn(sheet, document.issuer, {
    label: "FURNIZOR",
    x: headerLeftX,
    width: headerLeftWidth,
    top: afterLogo,
    align: "left",
    details: issuerLegalLines(document.issuer),
  })
  const midBottom = drawDocumentColumn(sheet, document, isProforma)
  const rightBottom = drawPartyColumn(sheet, document.customer, {
    label: "CLIENT",
    x: headerRightX,
    width: headerRightWidth,
    top: afterLogo,
    align: "right",
  })
  const bottom = Math.min(leftBottom, midBottom, rightBottom) - 6
  horizontalRule(sheet.page, bottom, { thickness: 1.2, color: ink })
  sheet.y = bottom - 22
}

const drawTableHeader = (sheet: Sheet): void => {
  const top = sheet.y
  sheet.page.drawRectangle({
    x: margin,
    y: top - 4,
    width: contentWidth,
    height: 16,
    color: headerFill,
  })
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

/** Prefers the readable unit name and falls back to the UN/ECE code when it does not fit. */
const unitLabel = (sheet: Sheet, unit: RenderableLine["unitOfMeasure"]): string =>
  sheet.fonts.regular.widthOfTextAtSize(unit.name, 8) <= (columns[3]?.width ?? 42) - 6 ? unit.name : unit.code

const drawTableRow = (sheet: Sheet, line: RenderableLine, index: number): void => {
  const descriptionColumn = columns[1]?.width ?? 187
  const description = wrapText(sheet.fonts.bold, 8, descriptionColumn, line.description)
  const height = Math.max(description.length * 10, 10) + 8
  if (sheet.y - height < bottomLimit) {
    addPage(sheet)
    drawTableHeader(sheet)
  }
  const top = sheet.y
  const cells: ReadonlyArray<string> = [
    String(index + 1),
    "",
    formatAmount(line.quantity),
    unitLabel(sheet, line.unitOfMeasure),
    formatAmount(line.unitPrice),
    formatAmount(line.totalExcludingVat),
    `${formatRate(line.vatRate)}%`,
    formatAmount(line.vatAmount),
  ]
  cells.forEach((value, cellIndex) => {
    if (value === "") return
    const column = columns[cellIndex]
    if (column === undefined) return
    putText(sheet.page, value, {
      x: columnOffsets[cellIndex] ?? margin,
      y: top,
      size: 8,
      font: sheet.fonts.regular,
      color: cellIndex === 0 ? muted : ink,
      align: column.align,
      width: column.width,
    })
  })
  putLines(sheet.page, description, {
    x: columnOffsets[1] ?? margin,
    width: descriptionColumn,
    top,
    size: 8,
    font: sheet.fonts.bold,
    leading: 10,
  })
  horizontalRule(sheet.page, top - height + 6)
  sheet.y = top - height
}

/** Largest size between 8 and 11.5 at which `text` still fits `available`. */
const fittingSize = (font: Fonts["bold"], text: string, available: number): number => {
  for (let size = 11.5; size > 8; size -= 0.5) {
    if (font.widthOfTextAtSize(text, size) <= available) return size
  }
  return 8
}

const drawTotals = (sheet: Sheet, document: RenderableDocument, isProforma: boolean): void => {
  const width = 190
  const x = contentRight - width
  const money = (value: string): string => `${formatAmount(value)} ${document.currency}`
  let cursor = sheet.y
  const row = (label: string, value: string, options: { readonly bold?: boolean; readonly small?: boolean } = {}): void => {
    const size = options.small === true ? 7.5 : 8.5
    const font = options.bold === true ? sheet.fonts.bold : sheet.fonts.regular
    putText(sheet.page, label, {
      x: options.small === true ? x + 8 : x,
      y: cursor,
      size,
      font: sheet.fonts.regular,
      color: options.small === true ? muted : ink,
    })
    putText(sheet.page, value, { x, y: cursor, size, font, align: "right", width })
    cursor -= options.small === true ? 11 : 13
  }
  row("Total fără TVA", money(document.totalExcludingVat))
  for (const vat of document.vatBreakdown) {
    row(`TVA ${formatRate(vat.rate)}% din ${formatAmount(vat.vatBaseAmount)}`, formatAmount(vat.vatAmount), { small: true })
  }
  horizontalRule(sheet.page, cursor + 7, { color: rule })
  cursor -= 3
  row("Total TVA", money(document.vatTotal))
  const boxTop = cursor - 2
  const boxHeight = 26
  sheet.page.drawRectangle({ x, y: boxTop - boxHeight, width, height: boxHeight, color: ink })
  const grandLabel = isProforma ? "TOTAL PROFORMĂ" : "TOTAL DE PLATĂ"
  const grandValue = money(document.totalIncludingVat)
  const labelWidth = sheet.fonts.bold.widthOfTextAtSize(grandLabel, 7.5)
  const available = width - labelWidth - 28
  const valueSize = fittingSize(sheet.fonts.bold, grandValue, available)
  putText(sheet.page, grandLabel, {
    x: x + 10,
    y: boxTop - 17,
    size: 7.5,
    font: sheet.fonts.bold,
    color: paper,
  })
  putText(sheet.page, grandValue, {
    x,
    y: boxTop - 18,
    size: valueSize,
    font: sheet.fonts.bold,
    color: paper,
    align: "right",
    width: width - 10,
  })
  sheet.y = boxTop - boxHeight
}

/** Draws the proforma legal notice and returns the baseline below it, or `top` when absent. */
const drawProformaNotice = (sheet: Sheet, top: number, isProforma: boolean): number => {
  if (!isProforma) return top
  const width = contentWidth - 202
  const lines = wrapText(
    sheet.fonts.regular,
    8,
    width - 16,
    "Document nefiscal. Proforma nu generează obligații de plată a TVA și nu înlocuiește factura fiscală.",
  )
  const height = lines.length * 11 + 22
  sheet.page.drawRectangle({ x: margin, y: top - height, width, height, color: noteFill })
  sheet.page.drawRectangle({ x: margin, y: top - height, width: 2.5, height, color: warning })
  const cursor = putLines(sheet.page, ["MENȚIUNE LEGALĂ"], {
    x: margin + 10,
    width: width - 16,
    top: top - 12,
    size: 6.5,
    font: sheet.fonts.bold,
    color: muted,
    leading: 11,
  })
  putLines(sheet.page, lines, {
    x: margin + 10,
    width: width - 16,
    top: cursor,
    size: 8,
    font: sheet.fonts.regular,
    leading: 11,
  })
  return top - height
}

/**
 * Draws the free-form document remarks full width under the summary area. The
 * text is never truncated: whatever does not fit continues on a new page.
 */
const drawDocumentNotes = (sheet: Sheet, notes: string | null, top: number): void => {
  if (notes === null) return
  const width = contentWidth
  const innerWidth = width - 20
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
    sheet.page.drawRectangle({ x: margin, y: blockTop - height, width, height, color: noteFill })
    sheet.page.drawRectangle({ x: margin, y: blockTop - height, width: 2.5, height, color: accent })
    const cursor = putLines(sheet.page, ["OBSERVAȚII"], {
      x: margin + 10,
      width: innerWidth,
      top: blockTop - 12,
      size: 6.5,
      font: sheet.fonts.bold,
      color: muted,
      leading: 11,
    })
    putLines(sheet.page, chunk, {
      x: margin + 10,
      width: innerWidth,
      top: cursor,
      size: 8,
      font: sheet.fonts.regular,
      leading: 11,
    })
    sheet.y = blockTop - height
    blockTop = sheet.y - 14
  }
}

const drawFooters = (sheet: Sheet, isProforma: boolean): void => {
  const pages = sheet.document.getPages()
  const total = pages.length
  pages.forEach((page, index) => {
    horizontalRule(page, margin + 30)
    putText(page, isProforma
      ? "Proformă — document nefiscal, generat electronic."
      : "Document generat electronic, valabil fără semnătură și ștampilă.", {
      x: margin,
      y: margin + 18,
      size: 7,
      font: sheet.fonts.regular,
      color: muted,
    })
    putText(page, `Pagina ${String(index + 1)} din ${String(total)} · QWBE Invoicing`, {
      x: margin,
      y: margin + 18,
      size: 7,
      font: sheet.fonts.regular,
      color: muted,
      align: "right",
      width: contentWidth,
    })
  })
}

const renderPdf = async (
  document: RenderableDocument,
  fonts: { readonly regular: Uint8Array; readonly bold: Uint8Array },
  kind: "invoice" | "proforma",
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create({ updateMetadata: false })
  pdf.registerFontkit(fontkit)
  const embedded: Fonts = {
    regular: await pdf.embedFont(fonts.regular, { subset: true, customName: "DejaVuSans" }),
    bold: await pdf.embedFont(fonts.bold, { subset: true, customName: "DejaVuSansBold" }),
  }
  const issuedAt = new Date(document.issuedAt)
  const isProforma = kind === "proforma"
  const label = `${isProforma ? "Proformă" : "Factura"} ${document.series} ${String(document.number)}`
  const templateVersion = isProforma ? proformaTemplateVersion : invoiceTemplateVersion
  pdf.setTitle(label)
  pdf.setAuthor(document.issuer.name)
  pdf.setSubject(isProforma ? "PROFORMĂ — DOCUMENT NEFISCAL" : "Factură")
  pdf.setCreator("QWBE Invoicing")
  pdf.setProducer(`QWBE Invoicing ${templateVersion}`)
  pdf.setCreationDate(issuedAt)
  pdf.setModificationDate(issuedAt)

  const sheet: Sheet = {
    document: pdf,
    fonts: embedded,
    page: pdf.addPage([pageWidth, pageHeight]),
    y: contentTop,
  }
  const brandImage = document.issuer.branding === null ? null : document.issuer.branding.image
  const image = brandImage === null ? null : await pdf.embedPng(brandImage.pngBase64)
  drawHeader(sheet, document, isProforma, image)
  drawTableHeader(sheet)
  document.lines.forEach((line, index) => {
    drawTableRow(sheet, line, index)
  })

  const summaryHeight = 62 + document.vatBreakdown.length * 11
  if (sheet.y - summaryHeight < bottomLimit) addPage(sheet)
  sheet.y -= 14
  const summaryTop = sheet.y
  drawTotals(sheet, document, isProforma)
  const noticeBottom = drawProformaNotice(sheet, summaryTop, isProforma)
  drawDocumentNotes(sheet, document.notes, Math.min(sheet.y, noticeBottom) - 14)
  drawFooters(sheet, isProforma)

  return pdf.save({ useObjectStreams: false, addDefaultPage: false, updateFieldAppearances: false })
}

export const createPdfRenderer = (
  paths: { readonly regular?: string; readonly bold?: string } = {},
): InvoiceRenderer => {
  const fonts = Promise.all([
    readFile(paths.regular ?? regularFontPath),
    readFile(paths.bold ?? boldFontPath),
  ]).then(([regular, bold]) => ({ regular: new Uint8Array(regular), bold: new Uint8Array(bold) }))
  return {
    render: (invoice) => Effect.tryPromise({
      try: async () => ({
        bytes: await renderPdf(invoice, await fonts, "invoice"),
        mediaType: "application/pdf" as const,
        templateVersion: invoiceTemplateVersion,
      }),
      catch: () => new DocumentRenderingFailure({ template: invoiceTemplateVersion }),
    }),
    renderProforma: (proforma) => Effect.tryPromise({
      try: async () => ({
        bytes: await renderPdf(proforma, await fonts, "proforma"),
        mediaType: "application/pdf" as const,
        templateVersion: proformaTemplateVersion,
      }),
      catch: () => new DocumentRenderingFailure({ template: proformaTemplateVersion }),
    }),
  }
}
