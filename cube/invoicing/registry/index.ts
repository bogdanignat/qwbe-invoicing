import type { Authorize, OperationDependencies } from "../application/support.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { createIssuerOperations, type IssuerOperations } from "./application/issuer.ts"

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

export type RegistryOperations = IssuerOperations

export const createRegistryOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): RegistryOperations => ({
  ...createIssuerOperations(dependencies, permissions, authorize),
})

export { resolveVatConfiguration, validateIssuer } from "./domain/validation.ts"
export { normalizeIssuerDetails, validateIssuerForIssuance } from "./domain/issuer-details.ts"
export { currentVatRegistration, validateVatForIssuance } from "./domain/vat-regime.ts"
export type { VatRegistration } from "./domain/vat-regime.ts"
export { isTaxableVatRateOn } from "./domain/vat-catalogue.ts"
export type { VatRate } from "./domain/vat-catalogue.ts"
export type { IssuerView, VatCatalogue } from "./application/issuer.ts"
export type { IssuerOperations }
