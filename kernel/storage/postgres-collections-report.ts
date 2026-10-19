import type { CollectionInvoiceRow, PaymentsTransaction } from "../../cubes/invoicing/payments/index.ts"
import { money } from "./postgres-money.ts"
import { paymentsRead } from "./postgres-payments.ts"
import { integer, nullableText, text, type Row } from "./postgres-rows.ts"
import { monthlyRollup } from "./postgres-revenue-report.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type CollectionsTransaction = Pick<PaymentsTransaction, "aggregateCollections" | "listCollectionInvoices">

// A reversal row stores the positive amount it cancels; the sign comes from its kind.
const signedAmount = (alias: string) => `CASE WHEN ${alias}kind = 'reversal' THEN -${alias}amount ELSE ${alias}amount END`

const invoiceFrom = (row: Row): CollectionInvoiceRow => ({
  id: text(row, "id"), series: text(row, "series"), number: integer(row, "number"), issueDate: text(row, "issue_date"),
  dueDate: nullableText(row, "due_date"), customer: { name: text(row, "customer_legal_name") },
  totalIncludingVat: money(row, "total_including_tax"), paidAmount: money(row, "paid_amount"),
})

export const collectionsReportTransactionAdapter = (client: TransactionClient): CollectionsTransaction => ({
  aggregateCollections: (organizationId, period) => paymentsRead("aggregate collections", async () => {
    const { rows } = await client.query(
      `SELECT substr(payment_date, 1, 7) AS month, COALESCE(SUM(${signedAmount("")}), 0) AS collected
      FROM invoice_payments WHERE organization_id = $1 AND payment_date BETWEEN $2 AND $3
      GROUP BY ROLLUP (substr(payment_date, 1, 7)) ORDER BY month`,
      [organizationId, period.from, period.to],
    )
    const { months, total } = monthlyRollup(rows, (row) => ({ collected: money(row, "collected") }))
    return { months, collected: total.collected }
  }),
  listCollectionInvoices: (organizationId, period) => paymentsRead("list collection invoices", async () => {
    const { rows } = await client.query(
      `SELECT i.id, i.series, i.number, i.issue_date, i.due_date, i.customer_legal_name, i.total_including_tax,
        COALESCE(SUM(${signedAmount("p.")}), 0) AS paid_amount
      FROM issued_invoices i
      LEFT JOIN invoice_payments p ON p.organization_id = i.organization_id AND p.invoice_id = i.id
      WHERE i.organization_id = $1 AND i.issue_date BETWEEN $2 AND $3
      GROUP BY i.id
      ORDER BY i.due_date ASC NULLS LAST, i.id ASC`,
      [organizationId, period.from, period.to],
    )
    return rows.map(invoiceFrom)
  }),
})
