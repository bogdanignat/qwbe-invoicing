import type { DraftInvoice, ProductPreset, UnitOfMeasure } from "./draft-models.ts"
import type { EditableInvoiceLine } from "./invoice-authoring-model.ts"

/** Only the invoice series matter here: this frontend has no proforma authoring. */
export const authoringSeriesOptions = (
  series: ReadonlyArray<{ readonly documentType: "invoice" | "proforma"; readonly series: string }>,
): ReadonlyArray<string> =>
  series.filter((item) => item.documentType === "invoice").map((item) => item.series)

// `vatRateCode` is resolved by the caller on the document date at the moment of
// the choice. A later change of that date leaves filled lines alone; choosing
// the product again resolves it anew.
export const applyProductPreset = (
  line: EditableInvoiceLine,
  preset: ProductPreset,
  vatRateCode: string,
): EditableInvoiceLine => ({
  ...line,
  description: preset.description,
  quantity: "1",
  unitPrice: preset.unitPrice,
  unitOfMeasure: preset.unitOfMeasure,
  vatRateCode,
})

export const choosePresetForLine = (
  lines: ReadonlyArray<EditableInvoiceLine>,
  lineKey: string,
  preset: ProductPreset,
  vatRateCode: string,
): ReadonlyArray<EditableInvoiceLine> => lines.map((line) =>
  line.key === lineKey ? applyProductPreset(line, preset, vatRateCode) : line)

export const draftLinesForEditing = (
  draft: DraftInvoice,
): ReadonlyArray<EditableInvoiceLine> => draft.lines.map((line) => ({
  key: line.id,
  lineId: line.id,
  description: line.description,
  quantity: line.quantity,
  unitPrice: line.unitPrice,
  unitOfMeasure: line.unitOfMeasure,
  vatRateCode: line.vatRateCode,
}))

export const lineInputMatches = (
  input: { readonly description: string; readonly quantity: string; readonly unitPrice: string; readonly unitOfMeasure: UnitOfMeasure; readonly vatRateCode: string },
  line: { readonly description: string; readonly quantity: string; readonly unitPrice: string; readonly unitOfMeasure: UnitOfMeasure; readonly vatRateCode: string },
): boolean => input.description === line.description
  && input.quantity === line.quantity
  && input.unitPrice === line.unitPrice
  && input.unitOfMeasure.code === line.unitOfMeasure.code
  && input.unitOfMeasure.name === line.unitOfMeasure.name
  && input.vatRateCode === line.vatRateCode
