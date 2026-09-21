import type { DatabaseSync } from "node:sqlite"

import type { DraftLine, VatBreakdown } from "../../cube/invoicing/index.ts"
import { buyerFrom, integer, text, type Row } from "./sqlite-rows.ts"
import { lineFrom, vatTreatmentFrom } from "./sqlite-document-lines.ts"
import { issuerCompanyFrom } from "./sqlite-document-parties.ts"
import { sourceFrom } from "./sqlite-document-query.ts"

export const correctionFrom = (database: DatabaseSync, value: Row) => {
  const id = text(value, "id")
  const organizationId = text(value, "organization_id")
  const source = sourceFrom(value)
  const lines: ReadonlyArray<DraftLine> = database.prepare(
    "SELECT * FROM correction_lines WHERE correction_id = ? ORDER BY line_position",
  ).all(id).map((item) => lineFrom(item as Row))
  const vatBreakdown: ReadonlyArray<VatBreakdown> = database.prepare(
    "SELECT * FROM correction_tax_breakdown WHERE correction_id = ? ORDER BY line_position",
  ).all(id).map((item) => {
    const tax = item as Row
    const treatment = vatTreatmentFrom(tax, "tax_code", "rate", "category")
    return { code: treatment.code, rate: treatment.rate, vatCategoryCode: treatment.vatCategoryCode,
      vatExemptionReason: treatment.vatExemptionReason, vatBaseAmount: text(tax, "taxable_amount"), vatAmount: text(tax, "tax_amount") }
  })
  return {
    id, organizationId, originalInvoiceId: text(value, "original_invoice_id"), fiscalYear: integer(value, "fiscal_year"),
    series: text(value, "series"), number: integer(value, "number"), ...(source === undefined ? {} : { source }),
    issueDate: text(value, "issue_date"), issuedAt: text(value, "issued_at"), reason: text(value, "reason"),
    actorId: text(value, "actor_id"), currency: text(value, "currency"), issuer: issuerCompanyFrom(value, "issuer_"),
    customer: buyerFrom(value, "customer_"), lines, vatBreakdown, totalExcludingVat: text(value, "total_excluding_tax"),
    vatTotal: text(value, "tax_total"), totalIncludingVat: text(value, "total_including_tax"),
  }
}
