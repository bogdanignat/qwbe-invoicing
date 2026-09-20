import type { IssuerSnapshot, VatConfiguration } from "../../domain/invoice.ts"

// A configurable live profile is not the issuer snapshot frozen on a document.
export interface IssuerProfile extends Omit<IssuerSnapshot, "vatRegistered"> {
  readonly organizationId: string
  readonly defaultCurrency: string
  readonly defaultPaymentTermDays: number
  readonly vatConfigurations: ReadonlyArray<VatConfiguration>
}

export interface RawIssuerBrandingImage { readonly dataBase64: string }
export interface RawIssuerBranding { readonly text: string | null; readonly image: RawIssuerBrandingImage | null }
export type VatChange =
  | { readonly registered: true; effectiveFrom: string; readonly nonVatBasis?: never }
  | { readonly registered: false; effectiveFrom: string; readonly nonVatBasis: "article_310" }
export type ConfigureIssuerInput = Omit<IssuerProfile, "organizationId" | "branding" | "vatConfigurations"> & {
  readonly branding: RawIssuerBranding | null
  readonly vatChange: VatChange
}
