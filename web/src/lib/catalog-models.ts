import type { IssuerSnapshot } from "./party-models.ts"

export interface UnitOfMeasure {
  readonly code: string
  readonly name: string
}

export interface ProductPreset {
  readonly id: string
  readonly organizationId: string
  readonly description: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  // Code of the taxable rate the product prefers; absent means the issuer's default.
  readonly preferredVatRateCode?: string
}

export interface VatConfiguration {
  readonly code: string
  readonly rate: string
  readonly vatCategoryCode: VatCategoryCode
  readonly vatExemptionReason: string | null
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export type VatCategoryCode = "S" | "O"
export type NonVatBasis = "article_310"

interface VatRegistrationPeriod {
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export type VatRegistration = VatRegistrationPeriod & ({
  readonly registered: true
  readonly nonVatBasis?: never
} | {
  readonly registered: false
  readonly nonVatBasis: NonVatBasis
})

export type VatChange = {
  readonly registered: true
  readonly effectiveFrom: string
  readonly nonVatBasis?: never
} | {
  readonly registered: false
  readonly effectiveFrom: string
  readonly nonVatBasis: NonVatBasis
}

export interface VatRate extends VatConfiguration {
  readonly kind: "standard" | "reduced" | "non_vat"
  readonly label: string
}

export interface VatCatalogue {
  readonly rates: ReadonlyArray<VatRate>
}

export interface Issuer extends Omit<IssuerSnapshot, "vatRegistered"> {
  readonly organizationId: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly vatConfigurations: ReadonlyArray<VatConfiguration>
  readonly currentVat: VatRegistration | null
}

export type DocumentType = "invoice" | "proforma"

export interface DocumentSeries {
  readonly organizationId: string
  readonly documentType: DocumentType
  readonly series: string
}
