import {
  array, boolean, decodePage, nullableText, object, optionalText, text, type Decoder,
} from "./model-decoder.ts"
import { decodeBuyer, decodeUnitOfMeasure } from "./document-snapshot-decoders.ts"
import type { Deleted, DraftInvoice, VatCategoryCode } from "./draft-models.ts"

/**
 * Decoding for the draft contract, on the same principles as the snapshot
 * decoders: nothing that crosses the network is trusted as typed, and a field
 * the backend stopped sending fails at the boundary.
 *
 * The authoring side writes documents too, so the VAT triple (code, rate,
 * category, exemption reason) is asserted canonical — the stale-tax logic and
 * the payload comparison would otherwise reason over a treatment the server
 * would refuse. Parties and units reuse the snapshot decoders, which stay
 * structural: the server is the authority for what it already stored.
 */

export const ARTICLE_310_EXEMPTION_REASON = "Regim special de scutire conform art. 310 din Codul fiscal"
export const isTaxableVatCode = (code: string): boolean =>
  ["RO_STANDARD", "RO_REDUCED", "RO_REDUCED_5"].includes(code)

export const decodeVatCategoryCode = (input: unknown): VatCategoryCode => {
  const value = text(input, "vatCategoryCode")
  if (value !== "S" && value !== "O") throw new Error("invalid vatCategoryCode")
  return value
}

// The two treatments the backend can issue, stated as one exhaustive rule:
// a per-category `if` accepts anything the server later rejects simply by
// belonging to no branch.
export const canonicalVatTreatment = (
  code: string,
  rate: string,
  vatCategoryCode: VatCategoryCode,
  vatExemptionReason: string | null,
): void => {
  const numericRate = Number(rate)
  if (!/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(rate) || numericRate > 100) throw new Error("invalid rate")
  const valid = vatCategoryCode === "S"
    ? numericRate > 0 && vatExemptionReason === null && isTaxableVatCode(code)
    : code === "RO_NON_VAT" && numericRate === 0 && vatExemptionReason === ARTICLE_310_EXEMPTION_REASON
  if (!valid) throw new Error("invalid VAT treatment")
}

const decodeDocumentSource: Decoder<DraftInvoice["source"]> = (input) => {
  const value = object(input)
  return { app: text(value.app, "app"), kind: text(value.kind, "kind"), id: text(value.id, "id") }
}

const decodeLine: Decoder<DraftInvoice["lines"][number]> = (input) => {
  const value = object(input)
  const line = {
    id: text(value.id, "line.id"),
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

const decodeVatBreakdown: Decoder<DraftInvoice["vatBreakdown"][number]> = (input) => {
  const value = object(input)
  const breakdown = {
    code: text(value.code, "code"),
    rate: text(value.rate, "rate"),
    vatCategoryCode: decodeVatCategoryCode(value.vatCategoryCode),
    vatExemptionReason: nullableText(value.vatExemptionReason, "vatExemptionReason"),
    vatBaseAmount: text(value.vatBaseAmount, "vatBaseAmount"),
    vatAmount: text(value.vatAmount, "vatAmount"),
  }
  canonicalVatTreatment(breakdown.code, breakdown.rate, breakdown.vatCategoryCode, breakdown.vatExemptionReason)
  return breakdown
}

export const decodeDraft: Decoder<DraftInvoice> = (input) => {
  const value = object(input)
  const status = text(value.status, "status")
  if (status !== "draft" && status !== "issued" && status !== "proforma_issued") {
    throw new Error("invalid status")
  }
  const customerId = optionalText(value.customerId, "customerId")
  const source = value.source === undefined || value.source === null ? undefined : decodeDocumentSource(value.source)
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
    lines: array(value.lines, decodeLine, "lines"),
    vatBreakdown: array(value.vatBreakdown, decodeVatBreakdown, "vatBreakdown"),
    totalExcludingVat: text(value.totalExcludingVat, "totalExcludingVat"),
    vatTotal: text(value.vatTotal, "vatTotal"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}

export const decodeDeleted: Decoder<Deleted> = (input) => {
  if (!boolean(object(input).deleted, "deleted")) throw new Error("invalid deleted")
  return { deleted: true }
}

export const decodeDraftPage = decodePage(decodeDraft)
