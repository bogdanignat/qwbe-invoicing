import { HttpApiGroup } from "@effect/platform"

import { invoicingPermissions } from "./contracts/permissions.ts"

const identity = "invoicing"
const permissions = invoicingPermissions(identity)
const group = HttpApiGroup.make(identity)
const declaredPermissions = [
  permissions.read,
  permissions.manageCustomers,
  permissions.draftInvoices,
  permissions.issueInvoices,
  permissions.issueProformas,
  permissions.voidInvoices,
  permissions.recordPayments,
  permissions.manageSettings,
]

export const cube = {
  manifest: {
    name: identity,
    tables: `issuers issuer_tax_configurations document_series customers invoice_drafts draft_lines invoice_sequences
      issued_invoices issued_lines issued_tax_breakdown proformas proforma_lines proforma_tax_breakdown proforma_conversions
      proforma_invoice_conversions invoice_payments correction_documents correction_lines correction_tax_breakdown`.split(/\s+/),
    requiresAuth: true,
    permissions: declaredPermissions.map((name) => ({ name, roles: ["admin"] })),
  },
  create: () => ({
    group,
    handlers: {},
  }),
}

export * from "./contracts/index.ts"
export { calculateTotals } from "./domain/calculation.ts"
export { createInvoicingService } from "./application/invoicing.ts"
export type { InvoicingDependencies, InvoicingService, InvoicingTransaction } from "./application/invoicing.ts"
export type * from "./domain/invoice.ts"
export type * from "./domain/payments.ts"
export type { InvoicePaymentSummary, RecordPaymentResult } from "./application/payments.ts"
export type * from "./domain/corrections.ts"
