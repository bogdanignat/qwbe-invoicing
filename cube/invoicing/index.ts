import { HttpApiGroup } from "@effect/platform"

import { invoicingPermissions } from "./contracts/permissions.ts"

const identity = "invoicing"
const permissions = invoicingPermissions(identity)
const group = HttpApiGroup.make(identity)
const declaredPermissions: ReadonlyArray<string> = [
  permissions.read,
  permissions.manageCustomers,
  permissions.draftInvoices,
  permissions.issueInvoices,
  permissions.voidInvoices,
  permissions.recordPayments,
  permissions.manageSettings,
]

export const cube = {
  manifest: {
    name: identity,
    tables: [
      "issuers",
      "issuer_tax_configurations",
      "customers",
      "invoice_drafts",
      "draft_lines",
      "invoice_sequences",
      "issued_invoices",
      "issued_lines",
      "issued_tax_breakdown",
    ],
    requiresAuth: true,
    permissions: declaredPermissions.map((name) => ({ name, roles: ["admin"] })),
  },
  create: () => ({
    group,
    handlers: {},
  }),
}

export * from "./contracts/index.ts"
export { createInvoicingService } from "./application/invoicing.ts"
export type {
  InvoicingDependencies,
  InvoicingService,
  InvoicingTransaction,
  DraftInvoice,
  IssuedInvoice,
} from "./application/invoicing.ts"
export type {
  Address,
  AddDraftLineInput,
  ConfigureIssuerInput,
  CreateCustomerInput,
  CreateDraftInput,
  Customer,
  DraftLine,
  IssuerProfile,
  PartySnapshot,
  TaxBreakdown,
  TaxConfiguration,
} from "./domain/invoice.ts"
