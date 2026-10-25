/**
 * The choices an authoring screen offers and the edits they produce on lines.
 *
 * None of it is specific to an invoice: a proforma offers its own series from
 * the same catalogue, applies the same product presets and compares a line to
 * the stored one by the same fields.
 */
import type { DraftInvoice, DraftLineInput, ProductPreset } from "./draft-models.ts"
import type { EditableDocumentLine } from "./document-authoring-form-model.ts"
import { sameIdentifiers } from "./item-identifiers.ts"

/**
 * The series a screen may author under, which is a property of the document it
 * authors: an invoice never offers a proforma series and a proforma never
 * offers an invoice one, so the type is asked for rather than assumed.
 */
export const authoringSeriesOptions = (
  series: ReadonlyArray<{ readonly documentType: "invoice" | "proforma"; readonly series: string }>,
  documentType: "invoice" | "proforma",
): ReadonlyArray<string> =>
  series.filter((item) => item.documentType === documentType).map((item) => item.series)

// `vatRateCode` is resolved by the caller on the document date at the moment of
// the choice. A later change of that date leaves filled lines alone; choosing
// the product again resolves it anew. The line copies the product's code and
// EAN and keeps no link to it; a product without an EAN clears the one an
// earlier choice left on the line.
export const applyProductPreset = (
  line: EditableDocumentLine,
  preset: ProductPreset,
  vatRateCode: string,
): EditableDocumentLine => ({
  key: line.key,
  ...(line.lineId === undefined ? {} : { lineId: line.lineId }),
  description: preset.description,
  quantity: "1",
  unitPrice: preset.unitPrice,
  unitOfMeasure: preset.unitOfMeasure,
  vatRateCode,
  itemCode: preset.code,
  ...(preset.barcode === undefined ? {} : { barcode: preset.barcode }),
})

export const choosePresetForLine = (
  lines: ReadonlyArray<EditableDocumentLine>,
  lineKey: string,
  preset: ProductPreset,
  vatRateCode: string,
): ReadonlyArray<EditableDocumentLine> => lines.map((line) =>
  line.key === lineKey ? applyProductPreset(line, preset, vatRateCode) : line)

export const draftLinesForEditing = (
  draft: DraftInvoice,
): ReadonlyArray<EditableDocumentLine> => draft.lines.map((line) => ({
  key: line.id,
  lineId: line.id,
  description: line.description,
  quantity: line.quantity,
  unitPrice: line.unitPrice,
  unitOfMeasure: line.unitOfMeasure,
  vatRateCode: line.vatRateCode,
  ...(line.itemCode === undefined ? {} : { itemCode: line.itemCode }),
  ...(line.barcode === undefined ? {} : { barcode: line.barcode }),
}))

// The identifiers count too: an edit of the code alone is a change to save.
export const lineInputMatches = (input: DraftLineInput, line: DraftLineInput): boolean =>
  input.description === line.description
  && input.quantity === line.quantity
  && input.unitPrice === line.unitPrice
  && input.unitOfMeasure.code === line.unitOfMeasure.code
  && input.unitOfMeasure.name === line.unitOfMeasure.name
  && input.vatRateCode === line.vatRateCode
  && sameIdentifiers(input, line)
