import type { DatabaseSync } from "node:sqlite"

import { DomainConflict, type InvoicingTransaction } from "../../cube/invoicing/index.ts"
import { addressValues, read, row, rowsWanted, write, type Row } from "./sqlite-rows.ts"
import { saveLines } from "./sqlite-document-lines.ts"
import { draftKeyset, sourceFilter, sourceValues } from "./sqlite-document-query.ts"
import { draftFrom } from "./sqlite-document-rows.ts"

type DraftsTransaction = Pick<InvoicingTransaction, "saveDraft" | "findDraft" | "listDrafts" | "deleteDraft">

export const draftsTransactionAdapter = (database: DatabaseSync): DraftsTransaction => ({
  saveDraft: (draft) => write("save draft", () => {
    const result = database.prepare(`INSERT INTO invoice_drafts
      (id, organization_id, source_app, source_kind, source_id, customer_id, customer_party_type, customer_legal_name, customer_tax_identifier,
        customer_country_code, customer_city, customer_street, customer_county, customer_sector, customer_postal_code, customer_vat_registered,
         series, issue_date, due_date, currency, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET source_app=excluded.source_app,source_kind=excluded.source_kind,source_id=excluded.source_id,
       customer_id=excluded.customer_id, customer_party_type=excluded.customer_party_type,
       customer_legal_name=excluded.customer_legal_name, customer_tax_identifier=excluded.customer_tax_identifier,
       customer_country_code=excluded.customer_country_code, customer_city=excluded.customer_city,
        customer_street=excluded.customer_street, customer_county=excluded.customer_county, customer_sector=excluded.customer_sector,
        customer_postal_code=excluded.customer_postal_code, customer_vat_registered=excluded.customer_vat_registered, issue_date=excluded.issue_date,
       due_date=excluded.due_date, currency=excluded.currency, status=excluded.status, notes=excluded.notes
       WHERE invoice_drafts.organization_id=excluded.organization_id`)
      .run(draft.id, draft.organizationId, ...sourceValues(draft.source), draft.customerId ?? null, draft.customer.partyType,
         draft.customer.name, draft.customer.fiscalIdentifier, ...addressValues(draft.customer.address), Number(draft.customer.vatRegistered),
        draft.series, draft.issueDate, draft.dueDate, draft.currency, draft.status, draft.notes)
    if (result.changes === 0) throw new DomainConflict({ code: "draft_id_taken", message: "Draft id belongs to another organization" })
    saveLines(database, { table: "draft_lines" }, draft.id, draft.lines)
  }),
  findDraft: (organizationId, id) => read("find draft", () => {
    const value = row(database.prepare(`SELECT d.*,c.proforma_id AS source_proforma_id FROM invoice_drafts d
      LEFT JOIN proforma_conversions c ON c.organization_id=d.organization_id AND c.resulting_draft_id=d.id
      WHERE d.organization_id=? AND d.id=?`).get(organizationId, id))
    return value === undefined ? undefined : draftFrom(database, value)
  }),
  listDrafts: (organizationId, page, source) => read("list drafts", () => {
    const filter = sourceFilter(source)
    const keyset = draftKeyset(page)
    const values = database.prepare(`SELECT d.*,c.proforma_id AS source_proforma_id FROM invoice_drafts d
      LEFT JOIN proforma_conversions c ON c.organization_id=d.organization_id AND c.resulting_draft_id=d.id
      WHERE d.organization_id = ? AND d.status = 'draft'${filter.sql}${keyset.sql}
      ORDER BY d.issue_date DESC,d.id LIMIT ?`).all(organizationId, ...filter.values, ...keyset.values, rowsWanted(page)) as ReadonlyArray<Row>
    return values.map((value) => draftFrom(database, value))
  }),
  deleteDraft: (organizationId, id) => write("delete draft", () => {
    if (database.prepare("SELECT 1 FROM proforma_conversions WHERE organization_id=? AND resulting_draft_id=?").get(organizationId, id)) {
      throw new DomainConflict({ code: "derived_draft_cannot_be_deleted", message: "Draft derived from a proforma cannot be deleted" })
    }
    const result = database.prepare("DELETE FROM invoice_drafts WHERE organization_id = ? AND id = ? AND status = 'draft'")
      .run(organizationId, id)
    if (result.changes === 0) throw new DomainConflict({ code: "draft_not_editable", message: "Draft cannot be deleted" })
  }),
})
