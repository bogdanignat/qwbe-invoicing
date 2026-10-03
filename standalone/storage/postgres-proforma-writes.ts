import type { Proforma } from "../../cube/invoicing/index.ts"
import { write } from "./postgres-errors.ts"
import { addressColumns, addressValues, booleanValue } from "./postgres-rows.ts"
import { insertStatement, pairs } from "./postgres-sql.ts"
import { breakdownColumns, breakdownValues, saveLines, vatTreatment } from "./postgres-document-lines.ts"
import { issuerColumns } from "./postgres-document-parties.ts"
import { sourceColumns, sourceValues } from "./postgres-document-query.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

/**
 * The proforma columns. The customer block starts with `customer_party_type`
 * here and with `customer_legal_name` on `issued_invoices`; the order is the
 * table's, so it is written out rather than shared.
 */
export const proformaColumns = [
  "id", "source_draft_id", "organization_id", ...sourceColumns(),
  "fiscal_year", "document_type", "series", "number", "issue_date", "due_date", "issued_at", "currency",
  "issuer_legal_name", "issuer_tax_identifier", ...addressColumns("issuer_"), ...issuerColumns(),
  "issuer_vat_registered", "issuer_branding",
  "customer_party_type", "customer_legal_name", "customer_tax_identifier", ...addressColumns("customer_"),
  "customer_vat_registered", "total_excluding_tax", "tax_total", "total_including_tax", "notes", "actor_id",
]

export const saveProforma = (client: TransactionClient, proforma: Proforma) =>
  write("save proforma", async () => {
    const statement = insertStatement("proformas", pairs(proformaColumns, [
      proforma.id, proforma.sourceDraftId, proforma.organizationId, ...sourceValues(proforma.source),
      Number(proforma.issueDate.slice(0, 4)), "proforma",
      proforma.series, proforma.number, proforma.issueDate, proforma.dueDate, proforma.issuedAt, proforma.currency,
      proforma.issuer.name, proforma.issuer.fiscalIdentifier, ...addressValues(proforma.issuer.address),
      proforma.issuer.legalForm, proforma.issuer.tradeRegistryNumber, proforma.issuer.iban,
      proforma.issuer.bankName, proforma.issuer.socialCapital, booleanValue(proforma.issuer.vatRegistered),
      proforma.issuer.branding === null ? null : JSON.stringify(proforma.issuer.branding),
      proforma.customer.partyType, proforma.customer.name, proforma.customer.fiscalIdentifier,
      ...addressValues(proforma.customer.address), booleanValue(proforma.customer.vatRegistered),
      proforma.totalExcludingVat, proforma.vatTotal, proforma.totalIncludingVat,
      proforma.notes, proforma.actorId,
    ]))
    await client.query(statement.sql, statement.values)
    await saveLines(
      client, { table: "proforma_lines", organizationId: proforma.organizationId }, proforma.id, proforma.lines,
    )
    for (const [position, tax] of proforma.vatBreakdown.entries()) {
      vatTreatment(tax.code, tax.rate, tax.vatCategoryCode, tax.vatExemptionReason)
      const breakdown = insertStatement("proforma_tax_breakdown", pairs(
        ["proforma_id", "organization_id", ...breakdownColumns],
        [proforma.id, proforma.organizationId, ...breakdownValues(position, tax)],
      ))
      await client.query(breakdown.sql, breakdown.values)
    }
    // Sealing last: the late-write triggers refuse lines and breakdown rows once
    // `sealed` is 1, so the document becomes immutable only when it is complete.
    await client.query(
      "UPDATE proformas SET sealed=1 WHERE id=$1 AND organization_id=$2 AND sealed=0",
      [proforma.id, proforma.organizationId],
    )
  })
