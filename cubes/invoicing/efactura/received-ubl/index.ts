/**
 * Reading the UBL XML another program wrote, an invoice or a credit note, into
 * a normalized document, with warnings for totals that do not add up and for
 * a buyer that is not the organization. Strict and bounded: a document it
 * cannot read is refused with the field and the reason, never guessed. Pure;
 * `received` reads its archives with it. Required inside the e-Factura plugin,
 * so it is on exactly when e-Factura is.
 */
export const cube = {
  manifest: {
    name: "received-ubl",
    parent: "efactura",
    summary: "Reading third-party UBL invoices and credit notes into a normalized document with warnings",
    required: true,
    tables: [],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { RECEIVED_XML_LIMITS, readReceivedUbl } from "./domain/reader.ts"
// For a reader of the document that refuses a field the way this one does.
export { computable } from "./domain/fields.ts"
export { UblRefused, refuseField } from "./domain/xml-tree.ts"
export type {
  AllowanceCharge, Amount, Address, BillingReference, ItemCode, MonetaryTotals, Quantity, ReadFailure, ReceivedDocument, ReceivedKind,
  ReceivedLine, ReceivedParty, ReceivedRead, ReceivedWarning, Vat, VatBreakdown,
} from "./domain/document.ts"
