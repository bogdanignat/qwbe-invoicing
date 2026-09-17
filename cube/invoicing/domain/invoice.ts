import type { UnitOfMeasure } from "./unit-of-measures.ts"

export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county: string
  readonly sector?: number
  readonly postalCode?: string
}

export interface PartySnapshot {
  readonly name: string
  readonly fiscalIdentifier: string
  readonly address: Address
}

export interface IssuerBrandingImage {
  readonly pngBase64: string
  readonly width: number
  readonly height: number
}

export interface IssuerBranding {
  readonly text: string | null
  readonly image: IssuerBrandingImage | null
}

export type LegalForm = "srl" | "pfa"

export interface IssuerCompanySnapshot extends PartySnapshot {
  readonly legalForm: LegalForm
  readonly vatRegistered: boolean
  readonly tradeRegistryNumber: string
  readonly iban: string
  readonly bankName: string
  readonly socialCapital: string
}

export interface IssuerSnapshot extends IssuerCompanySnapshot {
  readonly branding: IssuerBranding | null
}

export type PartyType = "company" | "individual"

export interface BuyerSnapshot extends PartySnapshot {
  readonly partyType: PartyType
  readonly vatRegistered: boolean
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
  | "create_draft_invoice_from_proforma"
  | "create_correction"

export type IdempotencyResultKind = "invoice" | "proforma" | "correction" | "draft"

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

export interface VatConfiguration extends VatTreatment {
  readonly code: string
  readonly rate: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export interface IssuerProfile extends Omit<IssuerSnapshot, "vatRegistered"> {
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

export interface DraftLine extends VatTreatment {
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
  readonly notes: string | null
  readonly lines: readonly DraftLine[]
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
}

export interface DraftInvoice extends DocumentContent {
  readonly id: string
  readonly organizationId: string
  readonly sourceProformaId: string | null
  readonly customerId?: string
  readonly series: string
  readonly status: "draft" | "issued" | "proforma_issued"
}

/**
 * UNCL5305 category, narrowed to the two treatments the product implements.
 *
 * `S` is standard or reduced rated. `O` — not subject to VAT — is what ANAF's
 * technical recommendation assigns to a supply by an Article 310 issuer, with
 * BT-121 = `VATEX-EU-O` and the legal reference in BT-22. `E` (exempt) is
 * absent on purpose: the standard keeps it for cases we do not issue, such as
 * the travel agents' margin scheme, and a category nothing can produce would
 * only leave branches no document reaches. docs/VAT_TREATMENT.md has the
 * reasoning; `cube/efactura` still knows all three, because it renders the
 * standard rather than this product's subset.
 */
export type VatCategoryCode = "S" | "O"
export interface VatTreatment {
  vatCategoryCode: VatCategoryCode
  vatExemptionReason: string | null
}
export interface VatBreakdown extends VatTreatment {
  readonly code: string
  readonly rate: string
  readonly vatBaseAmount: string
  readonly vatAmount: string
}

export interface NumberedDocumentSnapshot extends DocumentContent {
  readonly id: string
  readonly organizationId: string
  readonly series: string
  readonly number: number
  readonly issuedAt: string
  readonly actorId: string
  readonly issuer: IssuerSnapshot
}

export type EFacturaStatus = "not_sent" | "pending" | "sent" | "accepted" | "rejected"
export interface IssuedInvoice extends NumberedDocumentSnapshot {
  readonly draftId: string | null
  readonly sourceProformaId: string | null
  readonly eFacturaStatus: EFacturaStatus
}

export type IssuedInvoiceSummary = Omit<IssuedInvoice, "issuer"> & { readonly issuer: IssuerCompanySnapshot }

export interface AuditEvent {
  readonly id: string
  readonly organizationId: string
  readonly actorId: string
  readonly occurredAt: string
  readonly action: string
  readonly targetKind: string
  readonly targetId: string
  readonly reason?: string
}
