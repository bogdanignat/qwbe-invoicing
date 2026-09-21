import { decodeUnitOfMeasure } from "./catalog-decoders.ts"
import { canonicalVatTreatment, decodeVatCategoryCode } from "./vat-model-decoders.ts"
import { array, nullableText, object, optionalText, text, type Decoder } from "./model-decoder.ts"
import { decodeBuyer } from "./party-decoders.ts"
import type { DocumentSource, DraftInvoice, DraftLine, VatBreakdown } from "./document-models.ts"

export const decodeDocumentSource: Decoder<DocumentSource> = (input) => {
  const value = object(input)
  return {
    app: text(value.app, "app"),
    kind: text(value.kind, "kind"),
    id: text(value.id, "id"),
  }
}

export const optionalDocumentSource = (input: unknown): DocumentSource | undefined =>
  input === undefined || input === null ? undefined : decodeDocumentSource(input)

export const decodeDraftLine: Decoder<DraftLine> = (input) => {
  const value = object(input)
  const line = {
    id: text(value.id, "id"),
    description: text(value.description, "description"),
    quantity: text(value.quantity, "quantity"),
    unitPrice: text(value.unitPrice, "unitPrice"),
    unitOfMeasure: decodeUnitOfMeasure(value.unitOfMeasure),
    vatRateCode: text(value.vatRateCode, "vatRateCode"),
    vatRate: text(value.vatRate, "vatRate"),
    vatCategoryCode: decodeVatCategoryCode(value.vatCategoryCode),
    vatExemptionReason: nullableText(value.vatExemptionReason, "vatExemptionReason"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
    vatAmount: text(value.vatAmount, "vatAmount"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
  canonicalVatTreatment(line.vatRateCode, line.vatRate, line.vatCategoryCode, line.vatExemptionReason)
  return line
}

export const decodeVatBreakdown: Decoder<VatBreakdown> = (input) => {
  const value = object(input)
  const breakdown = {
    code: text(value.code, "code"),
    rate: text(value.rate, "rate"),
    vatCategoryCode: decodeVatCategoryCode(value.vatCategoryCode),
    vatExemptionReason: nullableText(value.vatExemptionReason, "vatExemptionReason"),
    vatBaseAmount: text(value.vatBaseAmount, "vatBaseAmount"),
    vatAmount: text(value.vatAmount, "vatAmount"),
  }
  canonicalVatTreatment(
    breakdown.code,
    breakdown.rate,
    breakdown.vatCategoryCode,
    breakdown.vatExemptionReason,
  )
  return breakdown
}

export const decodeDraft: Decoder<DraftInvoice> = (input) => {
  const value = object(input)
  const status = text(value.status, "status")
  if (status !== "draft" && status !== "issued" && status !== "proforma_issued") {
    throw new Error("invalid status")
  }
  const customerId = optionalText(value.customerId, "customerId")
  const source = optionalDocumentSource(value.source)
  return {
    id: text(value.id, "id"),
    organizationId: text(value.organizationId, "organizationId"),
    customer: decodeBuyer(value.customer),
    ...(customerId === undefined ? {} : { customerId }),
    ...(source === undefined ? {} : { source }),
    sourceProformaId: nullableText(value.sourceProformaId, "sourceProformaId"),
    series: text(value.series, "series"),
    issueDate: text(value.issueDate, "issueDate"),
    dueDate: nullableText(value.dueDate, "dueDate"),
    currency: text(value.currency, "currency"),
    notes: nullableText(value.notes, "notes"),
    status,
    lines: array(value.lines, decodeDraftLine, "lines"),
    vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
    vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}
