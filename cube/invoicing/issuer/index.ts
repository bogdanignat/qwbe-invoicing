const identity = "issuer"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    tables: ["issuers", "issuer_tax_configurations"],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { createIssuerOperations } from "./application/issuer.ts"
export type { IssuerOperations, IssuerView, VatCatalogue } from "./application/issuer.ts"
export type { BrandingNormalizer, IssuerTransaction } from "./application/ports.ts"
export type { IssuerProfile, ConfigureIssuerInput, RawIssuerBrandingImage, RawIssuerBranding, VatChange } from "./domain/issuer.ts"
export { resolveVatConfiguration, validateIssuer } from "./domain/validation.ts"
export { normalizeIssuerDetails, validateIssuerForIssuance } from "./domain/issuer-details.ts"
export { currentVatRegistration, validateVatForIssuance } from "./domain/vat-regime.ts"
export type { VatRegistration } from "./domain/vat-regime.ts"
export { isTaxableVatRateOn } from "./domain/vat-catalogue.ts"
export type { VatRate } from "./domain/vat-catalogue.ts"
export { issuerMigrations } from "./contracts/migrations.ts"
export type { IssuerMigration } from "./contracts/migrations.ts"
