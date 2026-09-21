import { authoringDocumentPayload, type EditableInvoiceLine, type InvoiceAuthoringForm } from "./invoice-authoring-state.ts"
import type { AuthoringProformaInput } from "./invoicing-client.ts"

export const proformaAuthoringPayload = (
  form: InvoiceAuthoringForm,
  lines: ReadonlyArray<EditableInvoiceLine>,
): AuthoringProformaInput => {
  const { series: proformaSeries, ...document } = authoringDocumentPayload(form, lines)
  return { ...document, proformaSeries }
}
