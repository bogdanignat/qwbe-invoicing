import { Schema } from "effect"

import {
  bodyObject, Buyer, BuyerSelection, DocumentNotes, DocumentSource, nullableString, optional,
  optionalNullableNotes, optionalNullableString, optionalString, pageOf, requireBuyer, UnitOfMeasure,
} from "./schema-primitives.ts"

export const VatTreatmentFields = { vatCategoryCode: Schema.Literal("S", "O"), vatExemptionReason: nullableString }
export const DraftLine = Schema.Struct({
  ...VatTreatmentFields, id: Schema.String, description: Schema.String, quantity: Schema.String,
  unitPrice: Schema.String, unitOfMeasure: UnitOfMeasure, vatRateCode: Schema.String,
  vatRate: Schema.String, totalExcludingVat: Schema.String, vatAmount: Schema.String, totalIncludingVat: Schema.String,
})
export const VatBreakdown = Schema.Struct({
  ...VatTreatmentFields, code: Schema.String, rate: Schema.String, vatBaseAmount: Schema.String, vatAmount: Schema.String,
})
export const DraftInvoice = Schema.Struct({
  id: Schema.String, organizationId: Schema.String, sourceProformaId: nullableString,
  customer: Buyer, customerId: optionalString, source: optional(DocumentSource), series: Schema.String,
  issueDate: Schema.String, dueDate: nullableString, currency: Schema.String, notes: DocumentNotes,
  status: Schema.Literal("draft", "issued", "proforma_issued"), lines: Schema.Array(DraftLine),
  vatBreakdown: Schema.Array(VatBreakdown), totalExcludingVat: Schema.String,
  vatTotal: Schema.String, totalIncludingVat: Schema.String,
})
export const DraftInvoicePage = pageOf(DraftInvoice)
export const DraftLineInput = Schema.Struct({
  description: Schema.String, quantity: Schema.String, unitPrice: Schema.String,
  unitOfMeasure: UnitOfMeasure, vatRateCode: Schema.String,
}).annotations(bodyObject)
// Lines are optional on creation: a draft may be saved empty, or arrive complete
// in one idempotent request. Only issuance insists on at least one line.
export const DraftInput = Schema.Struct({
  ...BuyerSelection.fields, source: optional(DocumentSource), series: Schema.String, issueDate: Schema.String,
  currency: optionalString, dueDate: optionalNullableString, notes: optionalNullableNotes,
  lines: optional(Schema.Array(DraftLineInput)),
}).annotations(bodyObject).pipe(requireBuyer)
export const UpdateDraftInput = Schema.Struct({
  ...BuyerSelection.fields, source: optional(Schema.NullOr(DocumentSource)), issueDate: Schema.String,
  dueDate: optionalNullableString, notes: optionalNullableNotes,
}).annotations(bodyObject).pipe(requireBuyer)
