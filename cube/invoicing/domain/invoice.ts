export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county?: string
  readonly postalCode?: string
}

export interface PartySnapshot {
  readonly legalName: string
  readonly taxIdentifier: string
  readonly address: Address
}

export type PartyType = "company" | "individual"

export interface BuyerSnapshot extends PartySnapshot {
  readonly partyType: PartyType
}

export interface TaxConfiguration {
  readonly code: string
  readonly category: "standard"
  readonly rate: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export interface IssuerProfile extends PartySnapshot {
  readonly organizationId: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly taxConfigurations: ReadonlyArray<TaxConfiguration>
}

export type DocumentType = "invoice" | "proforma"
export type NumberedDocumentType = DocumentType | "correction"

export interface DocumentSeries {
  readonly organizationId: string
  readonly documentType: DocumentType
  readonly series: string
}

export type ConfigureDocumentSeriesInput = Pick<DocumentSeries, "documentType" | "series">

export interface Customer extends BuyerSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly deletedAt?: string
}

export interface DraftLine {
  readonly id: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxCode: string
  readonly taxCategory: "standard"
  readonly taxRate: string
  readonly totalExcludingTax: string
  readonly taxAmount: string
  readonly totalIncludingTax: string
}

interface DocumentContent {
  readonly customer: BuyerSnapshot
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly lines: readonly DraftLine[]
  readonly taxBreakdown: ReadonlyArray<TaxBreakdown>
  readonly totalExcludingTax: string
  readonly taxTotal: string
  readonly totalIncludingTax: string
}

export interface DraftInvoice extends DocumentContent {
  readonly id: string
  readonly organizationId: string
  readonly customerId?: string
  readonly series: string
  readonly status: "draft" | "issued" | "proforma_issued"
}

export interface TaxBreakdown {
  readonly taxCode: string
  readonly category: "standard"
  readonly rate: string
  readonly taxableAmount: string
  readonly taxAmount: string
}

interface NumberedDocumentSnapshot extends DocumentContent {
  readonly id: string
  readonly organizationId: string
  readonly series: string
  readonly number: number
  readonly issuedAt: string
  readonly issuer: PartySnapshot
}

export type EFacturaStatus = "not_sent" | "pending" | "sent" | "accepted" | "rejected"
export interface IssuedInvoice extends NumberedDocumentSnapshot {
  readonly draftId: string | null
  readonly sourceProformaId: string | null
  readonly eFacturaStatus: EFacturaStatus
}

export interface Proforma extends NumberedDocumentSnapshot {
  readonly sourceDraftId: string | null
  readonly invoiceSeries: string
  readonly convertedDraftId: string | null
  readonly convertedInvoiceId: string | null
}

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

export type IssueProformaInput = { readonly draftId: string; readonly series: string }
export type ConvertProformaInput = { readonly proformaId: string }

export type ConfigureIssuerInput = Omit<IssuerProfile, "organizationId">

export type CreateCustomerInput = BuyerSnapshot

export type BuyerSource =
  | { readonly customerId: string; readonly customer?: never }
  | { readonly customer: BuyerSnapshot; readonly customerId?: never }

export interface RawDocumentLine {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxCode: string
}

export type AuthoringDocumentInput = BuyerSource & {
  readonly series: string
  readonly issueDate: string
  readonly dueDate?: string | null
  readonly currency: "RON"
  readonly lines: ReadonlyArray<RawDocumentLine>
}

export type AuthoringProformaInput = AuthoringDocumentInput & { readonly proformaSeries: string }

export type CreateDraftInput = BuyerSource & {
  readonly series: string
  readonly issueDate: string
  readonly currency?: string
  readonly dueDate?: string | null
}

export type UpdateDraftInput = BuyerSource & {
  readonly draftId: string
  readonly issueDate: string
  readonly dueDate?: string | null
}

export interface AddDraftLineInput {
  readonly draftId: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxCode: string
}

export type UpdateDraftLineInput = AddDraftLineInput & { readonly lineId: string }
