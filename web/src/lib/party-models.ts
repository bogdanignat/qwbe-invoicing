import type { IssuerLegalDetails, LegalForm } from "./issuer-details.ts"

export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county: string
  readonly sector?: number
  readonly postalCode?: string
}

export interface Party {
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

export interface IssuerCompanySnapshot extends Party, IssuerLegalDetails {
  readonly vatRegistered: boolean
}

export interface IssuerSnapshot extends IssuerCompanySnapshot {
  readonly branding: IssuerBranding | null
}

export type PartyType = "company" | "individual"

export interface BuyerSnapshot extends Party {
  readonly partyType: PartyType
  readonly vatRegistered: boolean
}

export interface Customer extends BuyerSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly defaultPaymentTermDays?: number
}

export type { LegalForm }
