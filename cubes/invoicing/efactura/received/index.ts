/**
 * Invoices received through the SPV: reading the UBL XML another program wrote
 * (an invoice or a credit note) into a normalized document, with warnings for
 * totals that do not add up and for a buyer that is not the organization. The
 * cube is pure: ANAF calls, the ZIP and storage are the host's. Required inside
 * the e-Factura plugin, so it is on exactly when e-Factura is.
 */
export const cube = {
  manifest: {
    name: "received",
    parent: "efactura",
    summary: "Invoices received through the SPV: reading third-party UBL into a normalized document with warnings",
    required: true,
    tables: [],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { RECEIVED_XML_LIMITS, readReceivedUbl } from "./domain/reader.ts"
export type {
  AllowanceCharge, Amount, Address, BillingReference, ItemCode, MonetaryTotals, Quantity, ReadFailure, ReceivedDocument, ReceivedKind,
  ReceivedLine, ReceivedParty, ReceivedRead, ReceivedWarning, Vat, VatBreakdown,
} from "./domain/document.ts"
