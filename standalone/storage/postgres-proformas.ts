import type { ProformaSummary } from "../../cube/invoicing/index.ts"
import type { ProformaTransaction } from "../../cube/invoicing/issuance/index.ts"
import { read } from "./postgres-errors.ts"
import { firstRow } from "./postgres-rows.ts"
import { fragments, rowsWanted } from "./postgres-sql.ts"
import { withoutIssuerBranding } from "./postgres-document-parties.ts"
import { documentKeyset, sourceFilter } from "./postgres-document-query.ts"
import { proformaFrom } from "./postgres-document-rows.ts"
import { proformaColumns, saveProforma } from "./postgres-proforma-writes.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type ProformasTransaction = Pick<ProformaTransaction, "saveProforma" | "findProforma" | "listProformas">

/**
 * The conversion columns a proforma carries are derived, not stored: a draft
 * conversion, an invoice conversion, or a direct issuance that went through the
 * derived draft. `COALESCE` keeps the same precedence the SQLite query had.
 */
const conversionJoins = `LEFT JOIN proforma_conversions c
    ON c.organization_id=p.organization_id AND c.proforma_id=p.id
  LEFT JOIN proforma_invoice_conversions i
    ON i.organization_id=p.organization_id AND i.proforma_id=p.id
  LEFT JOIN issued_invoices di
    ON di.organization_id=p.organization_id AND di.draft_id=c.resulting_draft_id AND di.source_proforma_id=p.id`

const conversionColumns = `c.resulting_draft_id AS converted_draft_id,
  COALESCE(i.resulting_invoice_id,di.id) AS converted_invoice_id`

/**
 * The list projection selects `issuer_branding` as NULL rather than reading it:
 * a list answer never carries the logo, and decoding one per row would parse a
 * base64 image the caller then throws away.
 */
const summaryColumns = proformaColumns
  .filter((column) => column !== "fiscal_year" && column !== "document_type" && column !== "issuer_branding")
  .map((column) => `p.${column}`).join(",")

export const proformasTransactionAdapter = (client: TransactionClient): ProformasTransaction => ({
  saveProforma: (proforma) => saveProforma(client, proforma),
  findProforma: (organizationId, id) => read("find proforma", async () => {
    const { rows } = await client.query(
      `SELECT p.*,${conversionColumns} FROM proformas p ${conversionJoins}
        WHERE p.organization_id=$1 AND p.id=$2 AND p.sealed=1`,
      [organizationId, id],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : await proformaFrom(client, value)
  }),
  listProformas: (organizationId, page, source) => read("list proformas", async () => {
    const where = fragments(2, [
      (start) => sourceFilter(source, start, "p."),
      (start) => documentKeyset(page, start, "p."),
    ])
    const { rows } = await client.query(
      `SELECT ${summaryColumns},NULL AS issuer_branding,${conversionColumns} FROM proformas p ${conversionJoins}
        WHERE p.organization_id=$1 AND p.sealed=1${where.sql}
        ORDER BY p.issue_date DESC,p.number DESC,p.id LIMIT $${String(2 + where.values.length)}`,
      [organizationId, ...where.values, rowsWanted(page)],
    )
    const summaries: Array<ProformaSummary> = []
    for (const value of rows) {
      summaries.push(withoutIssuerBranding(await proformaFrom(client, value)) as ProformaSummary)
    }
    return summaries
  }),
})
