import type { InvoicingTransaction, IssuedInvoiceSummary } from "../../cube/invoicing/index.ts"
import { read, write } from "./postgres-errors.ts"
import { addressColumns, addressValues, booleanValue, firstRow } from "./postgres-rows.ts"
import { fragments, insertStatement, pairs, rowsWanted } from "./postgres-sql.ts"
import { breakdownColumns, breakdownValues, saveLines, vatTreatment } from "./postgres-document-lines.ts"
import { issuerColumns, withoutIssuerBranding } from "./postgres-document-parties.ts"
import { documentKeyset, sourceColumns, sourceFilter, sourceValues } from "./postgres-document-query.ts"
import { issuedInvoiceFrom } from "./postgres-document-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type InvoicesTransaction = Pick<InvoicingTransaction,
  "saveIssuedInvoice" | "findIssuedInvoice" | "listIssuedInvoices">

const invoiceColumns = [
  "id", "draft_id", "source_proforma_id", "organization_id", ...sourceColumns(),
  "fiscal_year", "document_type", "series", "number", "issue_date", "due_date", "issued_at", "currency",
  "issuer_legal_name", "issuer_tax_identifier", ...addressColumns("issuer_"), ...issuerColumns(),
  "issuer_vat_registered", "issuer_branding",
  "customer_legal_name", "customer_tax_identifier", "customer_party_type", ...addressColumns("customer_"),
  "customer_vat_registered", "total_excluding_tax", "tax_total", "total_including_tax",
  "e_factura_status", "notes", "actor_id",
]

/**
 * The summary projection. `issuer_branding` is selected as NULL on purpose: a
 * list answer never carries the logo, and the decoder still needs the field to
 * be present.
 */
const summaryColumns = invoiceColumns
  .filter((column) => column !== "fiscal_year" && column !== "document_type" && column !== "issuer_branding")
  .join(",")

export const invoicesTransactionAdapter = (client: TransactionClient): InvoicesTransaction => ({
  saveIssuedInvoice: (invoice) => write("save issued invoice", async () => {
    const statement = insertStatement("issued_invoices", pairs(invoiceColumns, [
      invoice.id, invoice.draftId, invoice.sourceProformaId, invoice.organizationId,
      ...sourceValues(invoice.source), Number(invoice.issueDate.slice(0, 4)), "invoice",
      invoice.series, invoice.number, invoice.issueDate, invoice.dueDate, invoice.issuedAt, invoice.currency,
      invoice.issuer.name, invoice.issuer.fiscalIdentifier, ...addressValues(invoice.issuer.address),
      invoice.issuer.legalForm, invoice.issuer.tradeRegistryNumber, invoice.issuer.iban,
      invoice.issuer.bankName, invoice.issuer.socialCapital, booleanValue(invoice.issuer.vatRegistered),
      invoice.issuer.branding === null ? null : JSON.stringify(invoice.issuer.branding),
      invoice.customer.name, invoice.customer.fiscalIdentifier, invoice.customer.partyType,
      ...addressValues(invoice.customer.address), booleanValue(invoice.customer.vatRegistered),
      invoice.totalExcludingVat, invoice.vatTotal, invoice.totalIncludingVat,
      // `IssuedInvoice.eFacturaStatus` is required and non-nullable on the port,
      // so no cast and no default: a rename or a narrowing of the union has to
      // fail the typecheck here, not land as a runtime 23514 from the column's
      // CHECK and surface as a 409.
      invoice.eFacturaStatus,
      invoice.notes, invoice.actorId,
    ]))
    await client.query(statement.sql, statement.values)
    await saveLines(client, { table: "issued_lines" }, invoice.id, invoice.lines)
    for (const [position, tax] of invoice.vatBreakdown.entries()) {
      vatTreatment(tax.code, tax.rate, tax.vatCategoryCode, tax.vatExemptionReason)
      const breakdown = insertStatement("issued_tax_breakdown", pairs(
        ["invoice_id", ...breakdownColumns], [invoice.id, ...breakdownValues(position, tax)],
      ))
      await client.query(breakdown.sql, breakdown.values)
    }
  }),
  findIssuedInvoice: (organizationId, id) => read("find issued invoice", async () => {
    const { rows } = await client.query(
      "SELECT * FROM issued_invoices WHERE organization_id = $1 AND id = $2", [organizationId, id],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : await issuedInvoiceFrom(client, value)
  }),
  listIssuedInvoices: (organizationId, page, source) => read("list issued invoices", async () => {
    const where = fragments(2, [
      (start) => sourceFilter(source, start),
      (start) => documentKeyset(page, start),
    ])
    const { rows } = await client.query(
      `SELECT ${summaryColumns},NULL AS issuer_branding FROM issued_invoices
        WHERE organization_id = $1${where.sql}
        ORDER BY issue_date DESC, number DESC, id LIMIT $${String(2 + where.values.length)}`,
      [organizationId, ...where.values, rowsWanted(page)],
    )
    const summaries: Array<IssuedInvoiceSummary> = []
    for (const value of rows) {
      summaries.push(withoutIssuerBranding(await issuedInvoiceFrom(client, value)) as IssuedInvoiceSummary)
    }
    return summaries
  }),
})
