import type { Authorize, OperationDependencies } from "../application/support.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { createIssuerOperations, type IssuerOperations } from "./application/issuer.ts"
import { createProductPresetOperations, type ProductPresetOperations } from "./application/product-presets.ts"

const identity = "registry"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    tables: [],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export type RegistryOperations = IssuerOperations & ProductPresetOperations

export const createRegistryOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): RegistryOperations => ({
  ...createIssuerOperations(dependencies, permissions, authorize),
  ...createProductPresetOperations(dependencies, permissions, authorize),
})

export { normalizeProductPreset, resolveVatConfiguration, validateIssuer } from "./domain/validation.ts"
export { normalizeIssuerDetails, validateIssuerForIssuance } from "./domain/issuer-details.ts"
export { currentVatRegistration, validateVatForIssuance } from "./domain/vat-regime.ts"
export type { VatRegistration } from "./domain/vat-regime.ts"
export type { VatRate } from "./domain/vat-catalogue.ts"
export type { IssuerView, VatCatalogue } from "./application/issuer.ts"
export type { IssuerOperations, ProductPresetOperations }
