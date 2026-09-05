import type { Authorize, OperationDependencies } from "../application/support.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { createInvoiceOperations, type InvoiceOperations } from "./application/invoices.ts"
import { createProformaConversionOperations, type ProformaConversionOperations } from "./application/proforma-conversion.ts"
import { createProformaOperations, type ProformaOperations } from "./application/proformas.ts"

const identity = "issuance"

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

export type IssuanceOperations = InvoiceOperations & ProformaOperations & ProformaConversionOperations

export const createIssuanceOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): IssuanceOperations => ({
  ...createInvoiceOperations(dependencies, permissions, authorize),
  ...createProformaOperations(dependencies, permissions, authorize),
  ...createProformaConversionOperations(dependencies, permissions, authorize),
})

export type { InvoiceOperations, IssueInvoiceInput } from "./application/invoices.ts"
export type { ProformaConversionOperations } from "./application/proforma-conversion.ts"
export type { ProformaOperations } from "./application/proformas.ts"
