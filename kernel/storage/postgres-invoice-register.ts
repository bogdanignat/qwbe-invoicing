import type {
  CorrectionsTransaction, InvoiceRegisterCursor, InvoiceRegisterKind, InvoiceRegisterRow,
} from "../../cubes/invoicing/corrections/index.ts"
import { E_FACTURA_STATUSES, type EFacturaStatus, type PageQuery } from "../../cubes/invoicing/index.ts"
import { read } from "./postgres-errors.ts"
import { money } from "./postgres-money.ts"
import { integer, nullableText, text, type Row } from "./postgres-rows.ts"
import { fragments, rowsWanted, type SqlFragment } from "./postgres-sql.ts"
import { sourceFilter } from "./postgres-document-query.ts"
import { registerFilter } from "./postgres-register-filter.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type RegisterTransaction = Pick<CorrectionsTransaction, "listInvoiceRegister">
const statusFrom = (value: Row): EFacturaStatus => {
  const status = E_FACTURA_STATUSES.find((known) => known === text(value, "e_factura_status"))
  if (status === undefined) throw new Error("invalid e_factura_status")
  return status
}

const registerRowFrom = (value: Row): InvoiceRegisterRow => {
  const common = { id: text(value, "id"), series: text(value, "series"), number: integer(value, "number"),
    issueDate: text(value, "issue_date"), customer: { name: text(value, "customer_name") },
    currency: text(value, "currency"), totalIncludingVat: money(value, "total_including_tax") }
  const kind = text(value, "kind")
  if (kind === "invoice") {
    return { kind, ...common, dueDate: nullableText(value, "due_date"), eFacturaStatus: statusFrom(value) }
  }
  if (kind === "correction") {
    return { kind, ...common, dueDate: null, eFacturaStatus: statusFrom(value),
      originalReference: { id: text(value, "original_id"), series: text(value, "original_series"),
        number: integer(value, "original_number") } }
  }
  throw new Error("invalid invoice register kind")
}

const kindFilter = (kind: InvoiceRegisterKind | undefined, startIndex: number): SqlFragment =>
  kind === undefined ? { sql: "", values: [] } : { sql: ` AND kind=$${String(startIndex)}`, values: [kind] }

const registerKeyset = (page: PageQuery<InvoiceRegisterCursor>, startIndex: number): SqlFragment =>
  page.after === undefined
    ? { sql: "", values: [] }
    : {
      sql: ` AND (issue_date < $${String(startIndex)}
        OR (issue_date = $${String(startIndex + 1)} AND number < $${String(startIndex + 2)})
        OR (issue_date = $${String(startIndex + 3)} AND number = $${String(startIndex + 4)} AND id > $${String(startIndex + 5)})
        OR (issue_date = $${String(startIndex + 6)} AND number = $${String(startIndex + 7)}
          AND id = $${String(startIndex + 8)} AND kind > $${String(startIndex + 9)}))`,
      values: [page.after.issueDate, page.after.issueDate, page.after.number,
        page.after.issueDate, page.after.number, page.after.id,
        page.after.issueDate, page.after.number, page.after.id, page.after.kind],
    }

/**
 * The register is one ordering over two tables, so the keyset is applied to the
 * union and not to either side: the derived table carries `kind` as the last
 * tie-break, which is why the cursor has four levels.
 *
 * The filters (source, dates, search) are applied inside each half, so each
 * table narrows on its own `(organization_id, issue_date)` index before the
 * union is ordered; `kind` names a half and is applied to the union. The keyset
 * then pages inside the filtered rows, so a cursor never leaves the filter.
 *
 * Placeholder numbering, in order: $1 the organization for the invoice half,
 * then that half's optional source and register filters, then the organization
 * again for the correction half, then its filters, then the optional kind, then
 * the keyset, then the limit.
 */
export const invoiceRegisterTransactionAdapter = (client: TransactionClient): RegisterTransaction => ({
  listInvoiceRegister: (organizationId, page, source, filter) => read("list invoice register", async () => {
    const narrowed = (start: number, prefix: string) =>
      fragments(start, [(index) => sourceFilter(source, index, prefix), (index) => registerFilter(filter, index, prefix)])
    const invoiceFilters = narrowed(2, "i.")
    const correctionStart = 2 + invoiceFilters.values.length + 1
    const correctionFilters = narrowed(correctionStart, "c.")
    const outerStart = correctionStart + correctionFilters.values.length
    const outer = fragments(outerStart, [(index) => kindFilter(filter?.kind, index), (index) => registerKeyset(page, index)])
    const limitIndex = outerStart + outer.values.length
    const { rows } = await client.query(
      `SELECT * FROM (
        SELECT 'invoice' AS kind,i.id,i.series,i.number,i.issue_date,i.customer_legal_name AS customer_name,
          i.currency,i.total_including_tax,i.due_date,i.e_factura_status,
          NULL AS original_id,NULL AS original_series,NULL::integer AS original_number
        FROM issued_invoices i WHERE i.organization_id=$1${invoiceFilters.sql}
        UNION ALL
        SELECT 'correction' AS kind,c.id,c.series,c.number,c.issue_date,c.customer_legal_name AS customer_name,
          c.currency,c.total_including_tax,NULL AS due_date,c.e_factura_status,
          o.id AS original_id,o.series AS original_series,o.number AS original_number
        FROM correction_documents c
        JOIN issued_invoices o ON o.organization_id=c.organization_id AND o.id=c.original_invoice_id
        WHERE c.organization_id=$${String(2 + invoiceFilters.values.length)}${correctionFilters.sql}
      ) AS register_rows WHERE 1=1${outer.sql}
      ORDER BY issue_date DESC,number DESC,id ASC,kind ASC LIMIT $${String(limitIndex)}`,
      [organizationId, ...invoiceFilters.values, organizationId, ...correctionFilters.values,
        ...outer.values, rowsWanted(page)],
    )
    return rows.map(registerRowFrom)
  }),
})
