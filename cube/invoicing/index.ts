import { HttpApiGroup } from "@effect/platform"

import { invoicingPermissions } from "./contracts/permissions.ts"

const identity = "invoicing"
const permissions = invoicingPermissions(identity)
const group = HttpApiGroup.make(identity)

export const cube = {
  manifest: {
    name: identity,
    tables: `issuers issuer_tax_configurations document_series customers product_presets invoice_drafts draft_lines invoice_sequences
      issued_invoices issued_lines issued_tax_breakdown proformas proforma_lines proforma_tax_breakdown proforma_conversions
       proforma_invoice_conversions correction_documents correction_lines correction_tax_breakdown idempotency_records audit_events`.split(/\s+/),
    requiresAuth: true,
    // Every permission the cube defines is a permission it declares, so the
    // manifest reads them from the one place they exist instead of repeating
    // the list, where a new permission could be added and silently undeclared.
    permissions: Object.values(permissions).map((name) => ({ name, roles: ["admin"] })),
  },
  create: () => ({
    group,
    handlers: {},
  }),
}

export * from "./contracts/index.ts"
export { calculateTotals, validateFiscalDocument } from "./domain/calculation.ts"
export { validateVatTreatment } from "./domain/validation.ts"
export { unitOfMeasures } from "./domain/unit-of-measures.ts"
export { isValidRomanianCnp } from "./registry/domain/party-validation.ts"
export { ROMANIAN_COUNTIES, isRomanianCountyCode, romanianCountyName } from "./registry/domain/romanian-counties.ts"
export type { RomanianCounty } from "./registry/domain/romanian-counties.ts"
export { createInvoicingService } from "./application/invoicing.ts"
export { defaultPageSize, maximumPageSize } from "./application/support.ts"
export type { Page, PageRequest } from "./application/support.ts"
export type { DocumentCursor, DraftCursor, NameCursor, PageQuery } from "./application/ports.ts"
export type { InvoicingDependencies, InvoicingService, InvoicingTransaction } from "./application/invoicing.ts"
export type * from "./domain/invoice.ts"
export type * from "./domain/inputs.ts"
export type { Proforma, ProformaSummary, ProformaConversion, ProformaInvoiceConversion,
  IssueProformaInput, ConvertProformaInput, AuthoringProformaInput } from "./issuance/index.ts"
export type * from "./corrections/domain/corrections.ts"
export type * from "./domain/unit-of-measures.ts"
