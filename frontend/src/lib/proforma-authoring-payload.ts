import { authoringDocumentPayload } from "./invoice-authoring-payload.ts"
import type { EditableInvoiceLine, InvoiceAuthoringForm } from "./invoice-authoring-model.ts"
import type { AuthoringProformaInput } from "./proforma-models.ts"

/**
 * The body `POST /proformas` takes, built from the same form and lines an
 * invoice is built from.
 *
 * The one difference is the name of the series field, and it is a rename rather
 * than an addition: the server's schema admits no extra keys, so `series` is
 * destructured out instead of being left alongside `proformaSeries`.
 */
export const proformaAuthoringPayload = (
  form: InvoiceAuthoringForm,
  lines: ReadonlyArray<EditableInvoiceLine>,
): AuthoringProformaInput => {
  const { series: proformaSeries, ...document } = authoringDocumentPayload(form, lines)
  return { ...document, proformaSeries }
}
