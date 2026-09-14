import type { IssuerCompanySnapshot, NumberedDocumentSnapshot } from "../../domain/invoice.ts"
import type { AuthoringDocumentInput, BuyerSource } from "../../domain/inputs.ts"

export interface Proforma extends NumberedDocumentSnapshot {
  readonly sourceDraftId: string | null
  readonly convertedDraftId: string | null
  readonly convertedInvoiceId: string | null
}

export type ProformaSummary = Omit<Proforma, "issuer"> & { readonly issuer: IssuerCompanySnapshot }
export type AuthoringProformaInput = BuyerSource
  & Omit<AuthoringDocumentInput, "series" | "customer" | "customerId">
  & { readonly proformaSeries: string }
export type IssueProformaInput = { readonly draftId: string; readonly series: string }
export type ConvertProformaInput = { readonly proformaId: string; readonly invoiceSeries: string }

export type ProformaConversion = Readonly<{
  proformaId: string
  organizationId: string
  resultingDraftId: string
  actorId: string
  convertedAt: string
}>

export type ProformaInvoiceConversion = Readonly<{
  proformaId: string
  organizationId: string
  resultingInvoiceId: string
  actorId: string
  convertedAt: string
}>
