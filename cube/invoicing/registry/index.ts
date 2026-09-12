import type { Authorize, OperationDependencies } from "../application/support.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { createCustomerOperations, type CustomerOperations } from "./application/customers.ts"
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

export type RegistryOperations = IssuerOperations & CustomerOperations & ProductPresetOperations

export const createRegistryOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): RegistryOperations => ({
  ...createIssuerOperations(dependencies, permissions, authorize),
  ...createCustomerOperations(dependencies, permissions, authorize),
  ...createProductPresetOperations(dependencies, permissions, authorize),
})

export { normalizeProductPreset, resolveVatConfiguration, validateCustomer, validateIssuer } from "./domain/validation.ts"
export { normalizeIssuerDetails, validateIssuerForIssuance } from "./domain/issuer-details.ts"
export { validateVatForIssuance } from "./domain/vat-regime.ts"
export type { VatRate, VatRegistration } from "./domain/vat-regime.ts"
export type { IssuerView, VatCatalogue, VatInference } from "./application/issuer.ts"
export type { CustomerOperations, IssuerOperations, ProductPresetOperations }
