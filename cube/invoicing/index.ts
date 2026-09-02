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
      "document_series",
      "customers",
      "invoice_drafts",
      "draft_lines",
      "invoice_sequences",
      "issued_invoices",
      "issued_lines",
      "issued_tax_breakdown",
      "invoice_payments",
      "correction_documents",
      "correction_lines",
      "correction_tax_breakdown",
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
export { calculateTotals } from "./domain/calculation.ts"
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
  BuyerSnapshot,
  ConfigureIssuerInput,
  ConfigureDocumentSeriesInput,
  CreateCustomerInput,
  CreateDraftInput,
  Customer,
  DocumentSeries,
  DocumentType,
  DraftLine,
  IssuerProfile,
  PartySnapshot,
  PartyType,
  TaxBreakdown,
  TaxConfiguration,
  UpdateDraftInput,
  UpdateDraftLineInput,
} from "./domain/invoice.ts"
export type {
  Payment,
  PaymentStatus,
  RecordPaymentInput,
} from "./domain/payments.ts"
export type {
  InvoicePaymentSummary,
  RecordPaymentResult,
} from "./application/payments.ts"
export type {
  CorrectionDocument,
  CreateCorrectionInput,
} from "./domain/corrections.ts"
