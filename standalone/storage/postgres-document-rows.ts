import { calculateTotals, type DraftInvoice, type IssuedInvoice, type Proforma } from "../../cube/invoicing/index.ts"
import { buyerFrom, integer, nullableText, optionalText, text, type Row } from "./postgres-rows.ts"
import { loadLines, taxBreakdownFrom } from "./postgres-document-lines.ts"
import { issuerFrom } from "./postgres-document-parties.ts"
import { sourceFrom } from "./postgres-document-query.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

/**
 * Whole documents, assembled from the header row plus the line and breakdown
 * queries. Asynchronous because those are two more round trips on the same
 * connection; nothing else about the decoding changed.
 */

export const issuedInvoiceFrom = async (client: TransactionClient, value: Row): Promise<IssuedInvoice> => {
  const id = text(value, "id")
  const source = sourceFrom(value)
  return {
    id, draftId: nullableText(value, "draft_id"), sourceProformaId: nullableText(value, "source_proforma_id"),
    organizationId: text(value, "organization_id"), ...(source === undefined ? {} : { source }),
    series: text(value, "series"), number: integer(value, "number"), issueDate: text(value, "issue_date"),
    dueDate: nullableText(value, "due_date"), issuedAt: text(value, "issued_at"), actorId: text(value, "actor_id"),
    currency: text(value, "currency"), notes: nullableText(value, "notes"), issuer: issuerFrom(value, "issuer_branding"),
    customer: buyerFrom(value, "customer_"), lines: await loadLines(client, "issued_lines", id),
    vatBreakdown: await taxBreakdownFrom(client, "issued_tax_breakdown", "invoice_id", id),
    totalExcludingVat: text(value, "total_excluding_tax"), vatTotal: text(value, "tax_total"),
    totalIncludingVat: text(value, "total_including_tax"),
    eFacturaStatus: (optionalText(value, "e_factura_status") ?? "not_sent") as IssuedInvoice["eFacturaStatus"],
  }
}

export const proformaFrom = async (client: TransactionClient, value: Row): Promise<Proforma> => {
  const id = text(value, "id")
  const source = sourceFrom(value)
  return {
    id, sourceDraftId: nullableText(value, "source_draft_id"), organizationId: text(value, "organization_id"),
    ...(source === undefined ? {} : { source }), convertedDraftId: nullableText(value, "converted_draft_id"),
    convertedInvoiceId: nullableText(value, "converted_invoice_id"), series: text(value, "series"),
    number: integer(value, "number"), issueDate: text(value, "issue_date"), dueDate: nullableText(value, "due_date"),
    issuedAt: text(value, "issued_at"), actorId: text(value, "actor_id"), currency: text(value, "currency"),
    notes: nullableText(value, "notes"), issuer: issuerFrom(value, "issuer_branding"), customer: buyerFrom(value, "customer_"),
    lines: await loadLines(client, "proforma_lines", id),
    vatBreakdown: await taxBreakdownFrom(client, "proforma_tax_breakdown", "proforma_id", id),
    totalExcludingVat: text(value, "total_excluding_tax"), vatTotal: text(value, "tax_total"),
    totalIncludingVat: text(value, "total_including_tax"),
  }
}

const draftStatus = (value: Row): DraftInvoice["status"] => {
  switch (text(value, "status")) {
    case "draft": return "draft"
    case "issued": return "issued"
    case "proforma_issued": return "proforma_issued"
    default: throw new Error("invalid status")
  }
}

export const draftFrom = async (
  client: TransactionClient,
  value: Row,
): Promise<DraftInvoice & { readonly sourceProformaId: string | null }> => {
  const id = text(value, "id")
  const organizationId = text(value, "organization_id")
  const customerId = optionalText(value, "customer_id")
  const source = sourceFrom(value)
  const lines = await loadLines(client, "draft_lines", id)
  return {
    id, organizationId, sourceProformaId: nullableText(value, "source_proforma_id"),
    ...(source === undefined ? {} : { source }), ...(customerId === undefined ? {} : { customerId }),
    customer: buyerFrom(value, "customer_"), series: text(value, "series"), issueDate: text(value, "issue_date"),
    dueDate: nullableText(value, "due_date"), currency: text(value, "currency"), notes: nullableText(value, "notes"),
    status: draftStatus(value), lines, ...calculateTotals(lines),
  }
}
