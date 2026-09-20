import type { BuyerSnapshot, DocumentSeries, DocumentSource } from "./invoice.ts"
import type { UnitOfMeasure } from "./unit-of-measures.ts"

export type ConfigureDocumentSeriesInput = Pick<DocumentSeries, "documentType" | "series">

export type BuyerSource = { readonly customerId: string; readonly customer?: never } | { readonly customer: BuyerSnapshot; readonly customerId?: never }

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
  readonly notes?: string | null
  readonly lines: ReadonlyArray<RawDocumentLine>
}

export type CreateDraftInput = BuyerSource & {
  readonly source?: DocumentSource
  readonly series: string
  readonly issueDate: string
  readonly currency?: string
  readonly dueDate?: string | null
  readonly notes?: string | null
}

export type UpdateDraftInput = BuyerSource & {
  readonly draftId: string
  readonly source?: DocumentSource | null
  readonly issueDate: string
  readonly dueDate?: string | null
  readonly notes?: string | null
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
