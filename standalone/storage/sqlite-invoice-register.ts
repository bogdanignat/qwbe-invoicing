import type { DatabaseSync } from "node:sqlite"

import type {
  CorrectionsTransaction, InvoiceRegisterCursor, InvoiceRegisterRow,
} from "../../cube/invoicing/corrections/index.ts"
import type { EFacturaStatus, PageQuery } from "../../cube/invoicing/index.ts"
import { sourceFilter } from "./sqlite-document-query.ts"
import { integer, nullableText, read, rowsWanted, text, type Row } from "./sqlite-rows.ts"

type RegisterTransaction = Pick<CorrectionsTransaction, "listInvoiceRegister">
const statuses = new Set<EFacturaStatus>(["not_sent", "pending", "sent", "accepted", "rejected"])

const statusFrom = (value: Row): EFacturaStatus => {
  const status = text(value, "e_factura_status")
  if (!statuses.has(status as EFacturaStatus)) throw new Error("invalid e_factura_status")
  return status as EFacturaStatus
}

const registerRowFrom = (value: Row): InvoiceRegisterRow => {
  const common = { id: text(value, "id"), series: text(value, "series"), number: integer(value, "number"),
    issueDate: text(value, "issue_date"), customer: { name: text(value, "customer_name") },
    currency: text(value, "currency"), totalIncludingVat: text(value, "total_including_tax") }
  const kind = text(value, "kind")
  if (kind === "invoice") return { kind, ...common, dueDate: nullableText(value, "due_date"), eFacturaStatus: statusFrom(value) }
  if (kind === "correction") return { kind, ...common, dueDate: null, eFacturaStatus: null,
    originalReference: { id: text(value, "original_id"), series: text(value, "original_series"), number: integer(value, "original_number") } }
  throw new Error("invalid invoice register kind")
}

const registerKeyset = (page: PageQuery<InvoiceRegisterCursor>) => page.after === undefined
  ? { sql: "", values: [] as ReadonlyArray<string | number> }
  : { sql: ` AND (issue_date < ? OR (issue_date = ? AND number < ?)
      OR (issue_date = ? AND number = ? AND id > ?)
      OR (issue_date = ? AND number = ? AND id = ? AND kind > ?))`,
    values: [page.after.issueDate, page.after.issueDate, page.after.number,
      page.after.issueDate, page.after.number, page.after.id,
      page.after.issueDate, page.after.number, page.after.id, page.after.kind] }

export const invoiceRegisterTransactionAdapter = (database: DatabaseSync): RegisterTransaction => ({
  listInvoiceRegister: (organizationId, page, source) => read("list invoice register", () => {
    const invoiceSource = sourceFilter(source, "i.")
    const correctionSource = sourceFilter(source, "c.")
    const keyset = registerKeyset(page)
    const values = database.prepare(`SELECT * FROM (
      SELECT 'invoice' AS kind,i.id,i.series,i.number,i.issue_date,i.customer_legal_name AS customer_name,
        i.currency,i.total_including_tax,i.due_date,i.e_factura_status,
        NULL AS original_id,NULL AS original_series,NULL AS original_number
      FROM issued_invoices i WHERE i.organization_id=?${invoiceSource.sql}
      UNION ALL
      SELECT 'correction' AS kind,c.id,c.series,c.number,c.issue_date,c.customer_legal_name AS customer_name,
        c.currency,c.total_including_tax,NULL AS due_date,NULL AS e_factura_status,
        o.id AS original_id,o.series AS original_series,o.number AS original_number
      FROM correction_documents c
      JOIN issued_invoices o ON o.organization_id=c.organization_id AND o.id=c.original_invoice_id
      WHERE c.organization_id=?${correctionSource.sql}
    ) AS register_rows WHERE 1=1${keyset.sql}
    ORDER BY issue_date DESC,number DESC,id ASC,kind ASC LIMIT ?`)
      .all(organizationId, ...invoiceSource.values, organizationId, ...correctionSource.values,
        ...keyset.values, rowsWanted(page)) as ReadonlyArray<Row>
    return values.map(registerRowFrom)
  }),
})
