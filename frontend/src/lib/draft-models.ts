/**
 * The authoring contract: drafts, customers and the reference data a new
 * invoice is built from, as the fiscal API declares them.
 *
 * The frozen document shapes (`Address`, `BuyerSnapshot`, `UnitOfMeasure`,
 * `DocumentLine`, `VatBreakdownEntry`) are shared with the read-only snapshot
 * screens — the backend seals the same fields into a draft, a customer and an
 * issued document — so they are imported, not redefined.
 */
import type {
  Address, BuyerSnapshot, DocumentLine, UnitOfMeasure, VatBreakdownEntry,
} from "./document-snapshot.ts"

export type { Address, BuyerSnapshot, UnitOfMeasure }
export type DraftLine = DocumentLine
export type VatBreakdown = VatBreakdownEntry

export interface DocumentSource {
  readonly app: string
  readonly kind: string
  readonly id: string
}

export type DraftStatus = "draft" | "issued" | "proforma_issued"

export interface DraftInvoice {
  readonly id: string
  readonly organizationId: string
  readonly customer: BuyerSnapshot
  readonly customerId?: string
  readonly source?: DocumentSource
  readonly sourceProformaId: string | null
  readonly series: string
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly notes: string | null
  readonly status: DraftStatus
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
}

export interface Customer extends BuyerSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly defaultPaymentTermDays?: number
}

export type DocumentType = "invoice" | "proforma"

export interface DocumentSeries {
  readonly organizationId: string
  readonly documentType: DocumentType
  readonly series: string
}

export type VatCategoryCode = "S" | "O"
export type NonVatBasis = "article_310"

export interface VatConfiguration {
  readonly code: string
  readonly rate: string
  readonly vatCategoryCode: VatCategoryCode
  readonly vatExemptionReason: string | null
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export type VatRegistration = {
  readonly registered: true
  readonly effectiveFrom: string
  readonly effectiveTo?: string
  readonly nonVatBasis?: never
} | {
  readonly registered: false
  readonly nonVatBasis: NonVatBasis
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export interface VatRate extends VatConfiguration {
  readonly kind: "standard" | "reduced" | "non_vat"
  readonly label: string
}

export interface VatCatalogue {
  readonly rates: ReadonlyArray<VatRate>
}

/** The issuer profile the settings API serves; branding belongs to the PDF, not to authoring. */
export interface Issuer {
  readonly organizationId: string
  readonly name: string
  readonly fiscalIdentifier: string
  readonly address: Address
  readonly legalForm: "srl" | "pfa"
  readonly tradeRegistryNumber: string
  readonly iban: string
  readonly bankName: string
  readonly socialCapital: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly vatConfigurations: ReadonlyArray<VatConfiguration>
  readonly currentVat: VatRegistration | null
}

export interface ProductPreset {
  readonly id: string
  readonly organizationId: string
  readonly description: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  /** Code of the taxable rate the product prefers; absent means the issuer's default. */
  readonly preferredVatRateCode?: string
}

export type BuyerSource =
  | { readonly customerId: string; readonly customer?: never }
  | { readonly customer: BuyerSnapshot; readonly customerId?: never }

export type CreateDraftInput = BuyerSource & {
  readonly source?: DocumentSource
  readonly series: string
  readonly issueDate: string
  readonly currency?: "RON"
  readonly dueDate?: string | null
  readonly notes?: string | null
  /**
   * A draft is created whole: header and every line commit in one transaction
   * under one idempotency key, so a lost answer leaves either the finished
   * document or nothing — never a header a retry would have to reconcile.
   */
  readonly lines?: ReadonlyArray<DraftLineInput>
}

export type UpdateDraftInput = BuyerSource & {
  readonly source?: DocumentSource | null
  readonly issueDate: string
  readonly dueDate?: string | null
  readonly notes?: string | null
}

export interface DraftLineInput {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
}

export type AuthoringDocumentInput = CreateDraftInput & {
  readonly currency: "RON"
  readonly lines: ReadonlyArray<DraftLineInput>
}

export interface Deleted {
  readonly deleted: true
}
