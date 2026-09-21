import {
  invoiceDocumentSeries, proformaDocumentSeries,
  type DocumentSeries, type DraftInvoice, type ProductPreset,
} from "./models.ts"
import type { EditableInvoiceLine } from "./invoice-authoring-model.ts"

export const authoringSeriesOptions = (
  series: ReadonlyArray<DocumentSeries>,
): { readonly invoice: ReadonlyArray<string>; readonly proforma: ReadonlyArray<string> } => ({
  invoice: invoiceDocumentSeries(series).map((item) => item.series),
  proforma: proformaDocumentSeries(series).map((item) => item.series),
})

// `vatRateCode` is resolved by the caller on the document date at the moment of the choice. A later
// change of that date leaves filled lines alone; choosing the product again resolves it anew.
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
