import type { BuyerSnapshot, DocumentSeries, DocumentSource, IssuerProfile, ProductPreset } from "./invoice.ts"
import type { UnitOfMeasure } from "./unit-of-measures.ts"

// Request shapes accepted by the components; the persisted model lives in invoice.ts.
export type ConfigureDocumentSeriesInput = Pick<DocumentSeries, "documentType" | "series">

export type IssueProformaInput = { readonly draftId: string; readonly series: string }
export type ConvertProformaInput = { readonly proformaId: string }

export type ConfigureIssuerInput = Omit<IssuerProfile, "organizationId">

export type CustomerInput = BuyerSnapshot & { readonly defaultPaymentTermDays?: number }
export type CreateCustomerInput = CustomerInput
export type UpdateCustomerInput = CustomerInput & { readonly id: string }
export type ProductPresetInput = Pick<ProductPreset, "description" | "unitPrice" | "unitOfMeasure">
export type UpdateProductPresetInput = ProductPresetInput & { readonly id: string }

export type BuyerSource =
  | { readonly customerId: string; readonly customer?: never }
  | { readonly customer: BuyerSnapshot; readonly customerId?: never }

export interface RawDocumentLine {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
}

export type AuthoringDocumentInput = BuyerSource & {
  readonly source?: DocumentSource
  readonly series: string
  readonly issueDate: string
  readonly dueDate?: string | null
  readonly currency: "RON"
  readonly lines: ReadonlyArray<RawDocumentLine>
}

export type AuthoringProformaInput = AuthoringDocumentInput & { readonly proformaSeries: string }

export type CreateDraftInput = BuyerSource & {
  readonly source?: DocumentSource
  readonly series: string
  readonly issueDate: string
  readonly currency?: string
  readonly dueDate?: string | null
}

export type UpdateDraftInput = BuyerSource & {
  readonly draftId: string
  readonly source?: DocumentSource | null
  readonly issueDate: string
  readonly dueDate?: string | null
}

export interface AddDraftLineInput {
  readonly draftId: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
}

export type UpdateDraftLineInput = AddDraftLineInput & { readonly lineId: string }
