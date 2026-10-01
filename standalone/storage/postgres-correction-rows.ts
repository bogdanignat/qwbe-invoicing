import type { DraftLine, VatBreakdown } from "../../cube/invoicing/index.ts"
import { buyerFrom, integer, text, type Row } from "./postgres-rows.ts"
import { breakdownFrom, lineFrom } from "./postgres-document-lines.ts"
import { issuerCompanyFrom } from "./postgres-document-parties.ts"
import { sourceFrom } from "./postgres-document-query.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

export const correctionFrom = async (client: TransactionClient, value: Row) => {
  const id = text(value, "id")
  const organizationId = text(value, "organization_id")
  const source = sourceFrom(value)
  const lineRows = await client.query(
    "SELECT * FROM correction_lines WHERE correction_id = $1 ORDER BY line_position", [id],
  )
  const lines: ReadonlyArray<DraftLine> = lineRows.rows.map(lineFrom)
  const taxRows = await client.query(
    "SELECT * FROM correction_tax_breakdown WHERE correction_id = $1 ORDER BY line_position", [id],
  )
  const vatBreakdown: ReadonlyArray<VatBreakdown> = taxRows.rows.map(breakdownFrom)
  return {
    id, organizationId, originalInvoiceId: text(value, "original_invoice_id"), fiscalYear: integer(value, "fiscal_year"),
    series: text(value, "series"), number: integer(value, "number"), ...(source === undefined ? {} : { source }),
    issueDate: text(value, "issue_date"), issuedAt: text(value, "issued_at"), reason: text(value, "reason"),
    actorId: text(value, "actor_id"), currency: text(value, "currency"), issuer: issuerCompanyFrom(value, "issuer_"),
    customer: buyerFrom(value, "customer_"), lines, vatBreakdown, totalExcludingVat: text(value, "total_excluding_tax"),
    vatTotal: text(value, "tax_total"), totalIncludingVat: text(value, "total_including_tax"),
  }
}
