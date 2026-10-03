import { DomainConflict, type InvoicingTransaction } from "../../cube/invoicing/index.ts"
import { read, write } from "./postgres-errors.ts"
import { addressColumns, addressValues, booleanValue } from "./postgres-rows.ts"
import { assignExcluded, fragments, insertStatement, pairs, rowsWanted } from "./postgres-sql.ts"
import { draftKeyset, sourceColumns, sourceFilter, sourceValues } from "./postgres-document-query.ts"
import { saveLines } from "./postgres-document-lines.ts"
import { draftFrom } from "./postgres-document-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type DraftsTransaction = Pick<InvoicingTransaction, "saveDraft" | "findDraft" | "listDrafts" | "deleteDraft">

const draftColumns = [
  "id", "organization_id", ...sourceColumns(), "customer_id", "customer_party_type",
  "customer_legal_name", "customer_tax_identifier", ...addressColumns("customer_"),
  "customer_vat_registered", "series", "issue_date", "due_date", "currency", "status", "notes",
]

/**
 * Everything the upsert refreshes. `series` and `organization_id` are absent on
 * purpose: the series is fixed when the draft is created, and the organization
 * is the guard in the WHERE clause rather than a value to overwrite.
 */
const draftUpdatedColumns = draftColumns.filter((column) =>
  column !== "id" && column !== "organization_id" && column !== "series")

const draftSelect = `SELECT d.*,c.proforma_id AS source_proforma_id FROM invoice_drafts d
  LEFT JOIN proforma_conversions c ON c.organization_id=d.organization_id AND c.resulting_draft_id=d.id`

export const draftsTransactionAdapter = (client: TransactionClient): DraftsTransaction => ({
  saveDraft: (draft) => write("save draft", async () => {
    const statement = insertStatement("invoice_drafts", pairs(draftColumns, [
      draft.id, draft.organizationId, ...sourceValues(draft.source), draft.customerId ?? null,
      draft.customer.partyType, draft.customer.name, draft.customer.fiscalIdentifier,
      ...addressValues(draft.customer.address), booleanValue(draft.customer.vatRegistered),
      draft.series, draft.issueDate, draft.dueDate, draft.currency, draft.status, draft.notes,
    ]))
    const { rowCount } = await client.query(
      `${statement.sql} ON CONFLICT (id) DO UPDATE SET ${assignExcluded(draftUpdatedColumns)}
        WHERE invoice_drafts.organization_id=excluded.organization_id`,
      statement.values,
    )
    // A conflicting id owned by another organization makes the DO UPDATE match
    // nothing, so the write reports no affected row instead of crossing tenants.
    if (rowCount === 0) {
      throw new DomainConflict({ code: "draft_id_taken", message: "Draft id belongs to another organization" })
    }
    await saveLines(client, { table: "draft_lines" }, draft.id, draft.lines)
  }),
  findDraft: (organizationId, id) => read("find draft", async () => {
    const { rows } = await client.query(
      `${draftSelect} WHERE d.organization_id=$1 AND d.id=$2`, [organizationId, id],
    )
    const [value] = rows
    return value === undefined ? undefined : await draftFrom(client, value)
  }),
  listDrafts: (organizationId, page, source) => read("list drafts", async () => {
    const where = fragments(2, [
      (start) => sourceFilter(source, start, "d."),
      (start) => draftKeyset(page, start),
    ])
    const { rows } = await client.query(
      `${draftSelect} WHERE d.organization_id = $1 AND d.status = 'draft'${where.sql}
        ORDER BY d.issue_date DESC,d.id LIMIT $${String(2 + where.values.length)}`,
      [organizationId, ...where.values, rowsWanted(page)],
    )
    const drafts: Array<Awaited<ReturnType<typeof draftFrom>>> = []
    for (const value of rows) drafts.push(await draftFrom(client, value))
    return drafts
  }),
  deleteDraft: (organizationId, id) => write("delete draft", async () => {
    const derived = await client.query(
      "SELECT 1 FROM proforma_conversions WHERE organization_id=$1 AND resulting_draft_id=$2", [organizationId, id],
    )
    if (derived.rows.length > 0) {
      throw new DomainConflict({
        code: "derived_draft_cannot_be_deleted", message: "Draft derived from a proforma cannot be deleted",
      })
    }
    const { rowCount } = await client.query(
      "DELETE FROM invoice_drafts WHERE organization_id = $1 AND id = $2 AND status = 'draft'", [organizationId, id],
    )
    if (rowCount === 0) {
      throw new DomainConflict({ code: "draft_not_editable", message: "Draft cannot be deleted" })
    }
  }),
})
