import type { UnitOfMeasure } from "./unit-of-measures.ts"

export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county?: string
  readonly postalCode?: string
}

export interface PartySnapshot {
  readonly name: string
  // CUI/CIF for companies, CNP for individuals. For the issuer the RO prefix also
  // marks VAT registration; e-Factura will later split it into BT-30 and BT-31.
  readonly fiscalIdentifier: string
  readonly address: Address
}

export type PartyType = "company" | "individual"

export interface BuyerSnapshot extends PartySnapshot {
  readonly partyType: PartyType
}

export interface DocumentSource {
  readonly app: string
  readonly kind: string
  readonly id: string
}

export interface IdempotencyAttempt {
  readonly key: string
  readonly fingerprint: string
}

export type IdempotencyOperation =
  | "issue_invoice_direct"
  | "issue_invoice_from_draft"
  | "issue_proforma_direct"
  | "issue_proforma_from_draft"
  | "issue_invoice_from_proforma"
  | "create_correction"

export type IdempotencyResultKind = "invoice" | "proforma" | "correction"

export interface IdempotencyRecord extends IdempotencyAttempt {
  readonly organizationId: string
  readonly operation: IdempotencyOperation
  readonly resultKind: IdempotencyResultKind
  readonly resultId: string
  readonly createdAt: string
}

export interface Idempotent<Input> {
  readonly request: Input
  readonly idempotency: IdempotencyAttempt
}

export interface VatConfiguration {
  readonly code: string
  readonly rate: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export interface IssuerProfile extends PartySnapshot {
  readonly organizationId: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly vatConfigurations: ReadonlyArray<VatConfiguration>
}

export type DocumentType = "invoice" | "proforma"
export type NumberedDocumentType = DocumentType | "correction"

export interface DocumentSeries {
  readonly organizationId: string
  readonly documentType: DocumentType
  readonly series: string
}

export interface Customer extends BuyerSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly defaultPaymentTermDays?: number
  readonly deletedAt?: string
}

export interface ProductPreset {
  readonly id: string
  readonly organizationId: string
  readonly description: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
}

export interface DraftLine {
  readonly id: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
  readonly vatRate: string
  readonly totalExcludingVat: string
  readonly vatAmount: string
  readonly totalIncludingVat: string
}

interface DocumentContent {
  readonly customer: BuyerSnapshot
  readonly source?: DocumentSource
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly lines: readonly DraftLine[]
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
}

export interface DraftInvoice extends DocumentContent {
  readonly id: string
  readonly organizationId: string
  readonly customerId?: string
  readonly series: string
  readonly status: "draft" | "issued" | "proforma_issued"
}

// VAT category per UNCL5305 (S, Z, E, O, AE) is not modelled yet; when e-Factura
// needs it the field is `vatCategoryCode`, never a bare `category`.
export interface VatBreakdown {
  readonly code: string
  readonly rate: string
  readonly vatBaseAmount: string
  readonly vatAmount: string
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
