import type { AuthoringDocumentInput } from "./draft-models.ts"
import type { DocumentBody } from "./document-snapshot.ts"

/**
 * A proforma: the sealed body of a commercial document, with a head of its own.
 *
 * It is deliberately not modelled as an `IssuedInvoice` even though the two
 * share every field a document renders. A proforma carries no e-Factura status
 * — it is not a fiscal document and the backend exposes no XML for it — and it
 * carries what no invoice has: the two ids that record what it was converted
 * into. Reusing the invoice type would mean either inventing a status the server
 * never sent or dropping the fields the only screen-level decision depends on.
 *
 * The conversion ids are mutually exclusive by construction on the server: a
 * proforma is converted once, into an invoice or into an editable draft. They
 * are still modelled as two independent nullable fields, because that is what
 * arrives, and the derivation that reads them is where the exclusivity is
 * stated once.
 */
export interface Proforma extends DocumentBody {
  readonly id: string
  readonly dueDate: string | null
  readonly notes: string | null
  /** The draft this proforma was issued from, when it was not authored directly. */
  readonly sourceDraftId: string | null
  readonly convertedInvoiceId: string | null
  readonly convertedDraftId: string | null
}

/**
 * The body `POST /proformas` takes.
 *
 * `series` is replaced by `proformaSeries`, not added to: the server's
 * `AuthoringProformaInput` shares every authoring field with the invoice input
 * and names the series differently, so sending both would be rejected by a
 * schema that admits no extra keys. `Omit` is what keeps that a compile-time
 * fact instead of a convention the payload builder has to remember.
 */
export type AuthoringProformaInput = Omit<AuthoringDocumentInput, "series"> & {
  readonly proformaSeries: string
}

/** Both conversions take the same body: the invoice series the result is numbered in. */
export interface ConvertProformaInput {
  readonly invoiceSeries: string
}
