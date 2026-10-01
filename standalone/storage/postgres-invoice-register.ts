import type {
  CorrectionsTransaction, InvoiceRegisterCursor, InvoiceRegisterRow,
} from "../../cube/invoicing/corrections/index.ts"
import type { EFacturaStatus, PageQuery } from "../../cube/invoicing/index.ts"
import { read } from "./postgres-errors.ts"
import { integer, nullableText, text, type Row } from "./postgres-rows.ts"
import { fragments, rowsWanted, type SqlFragment } from "./postgres-sql.ts"
import { sourceFilter } from "./postgres-document-query.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

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
  if (kind === "invoice") {
    return { kind, ...common, dueDate: nullableText(value, "due_date"), eFacturaStatus: statusFrom(value) }
  }
  if (kind === "correction") {
    return { kind, ...common, dueDate: null, eFacturaStatus: null,
      originalReference: { id: text(value, "original_id"), series: text(value, "original_series"),
        number: integer(value, "original_number") } }
  }
  throw new Error("invalid invoice register kind")
}

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
 * Placeholder numbering, in order: $1 the organization for the invoice half,
 * then that half's optional source filter, then the organization again for the
 * correction half, then its source filter, then the keyset, then the limit.
 */
export const invoiceRegisterTransactionAdapter = (client: TransactionClient): RegisterTransaction => ({
  listInvoiceRegister: (organizationId, page, source) => read("list invoice register", async () => {
    const invoiceSource = fragments(2, [(start) => sourceFilter(source, start, "i.")])
    const correctionStart = 2 + invoiceSource.values.length + 1
    const correctionSource = fragments(correctionStart, [(start) => sourceFilter(source, start, "c.")])
    const keysetStart = correctionStart + correctionSource.values.length
    const keyset = registerKeyset(page, keysetStart)
    const limitIndex = keysetStart + keyset.values.length
    const { rows } = await client.query(
      `SELECT * FROM (
        SELECT 'invoice' AS kind,i.id,i.series,i.number,i.issue_date,i.customer_legal_name AS customer_name,
          i.currency,i.total_including_tax,i.due_date,i.e_factura_status,
          NULL AS original_id,NULL AS original_series,NULL::integer AS original_number
        FROM issued_invoices i WHERE i.organization_id=$1${invoiceSource.sql}
        UNION ALL
        SELECT 'correction' AS kind,c.id,c.series,c.number,c.issue_date,c.customer_legal_name AS customer_name,
          c.currency,c.total_including_tax,NULL AS due_date,NULL AS e_factura_status,
          o.id AS original_id,o.series AS original_series,o.number AS original_number
        FROM correction_documents c
        JOIN issued_invoices o ON o.organization_id=c.organization_id AND o.id=c.original_invoice_id
        WHERE c.organization_id=$${String(2 + invoiceSource.values.length)}${correctionSource.sql}
      ) AS register_rows WHERE 1=1${keyset.sql}
      ORDER BY issue_date DESC,number DESC,id ASC,kind ASC LIMIT $${String(limitIndex)}`,
      [organizationId, ...invoiceSource.values, organizationId, ...correctionSource.values,
        ...keyset.values, rowsWanted(page)],
    )
    return rows.map(registerRowFrom)
  }),
})
