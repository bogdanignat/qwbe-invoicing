import type { CorrectionsTransaction, RevenueFigures } from "../../cubes/invoicing/corrections/index.ts"
import { read } from "./postgres-errors.ts"
import { money } from "./postgres-money.ts"
import { integer, text, type Row } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type RevenueTransaction = Pick<CorrectionsTransaction, "aggregateRevenue">

/**
 * Splits a `GROUP BY ROLLUP (month)` result into the month rows and the grand
 * total, the one row whose month is NULL. PostgreSQL returns that row even when
 * nothing matched, so a missing one is a defect.
 */
export const monthlyRollup = <Figures>(rows: ReadonlyArray<Row>, figures: (row: Row) => Figures) => {
  const total = rows.find((row) => row.month === null)
  if (total === undefined) throw new Error("rollup total row is missing")
  return {
    months: rows.filter((row) => row.month !== null).map((row) => ({ month: text(row, "month"), ...figures(row) })),
    total: figures(total),
  }
}

const revenueFrom = (row: Row): RevenueFigures => ({
  revenueExcludingVat: money(row, "revenue_excluding_vat"), invoicedIncludingVat: money(row, "invoiced_including_vat"),
  invoiceCount: integer(row, "invoice_count"), correctionCount: integer(row, "correction_count"),
})

/**
 * Invoices and corrections by issue month; a correction's totals are already
 * negative, so a plain SUM nets them. The sums are BIGINT bani, which SUM turns
 * into an integral numeric and the money codec reads back as a decimal.
 */
export const revenueReportTransactionAdapter = (client: TransactionClient): RevenueTransaction => ({
  aggregateRevenue: (organizationId, period) => read("aggregate revenue", async () => {
    const { rows } = await client.query(
      `SELECT substr(issue_date, 1, 7) AS month,
        COALESCE(SUM(total_excluding_tax), 0) AS revenue_excluding_vat,
        COALESCE(SUM(total_including_tax), 0) AS invoiced_including_vat,
        (COUNT(*) FILTER (WHERE kind = 'invoice'))::int AS invoice_count,
        (COUNT(*) FILTER (WHERE kind = 'correction'))::int AS correction_count
      FROM (
        SELECT 'invoice' AS kind, issue_date, total_excluding_tax, total_including_tax
          FROM issued_invoices WHERE organization_id = $1 AND issue_date BETWEEN $2 AND $3
        UNION ALL
        SELECT 'correction' AS kind, issue_date, total_excluding_tax, total_including_tax
          FROM correction_documents WHERE organization_id = $1 AND issue_date BETWEEN $2 AND $3
      ) AS documents
      GROUP BY ROLLUP (substr(issue_date, 1, 7)) ORDER BY month`,
      [organizationId, period.from, period.to],
    )
    const { months, total } = monthlyRollup(rows, revenueFrom)
    return { months, totals: total }
  }),
})
