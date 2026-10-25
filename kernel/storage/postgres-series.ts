import { DomainConflict, type DocumentSeries, type InvoicingTransaction } from "../../cubes/invoicing/index.ts"
import { read, write } from "./postgres-errors.ts"
import { booleanInteger, booleanValue, firstRow, integer, optionalText, text, type Row } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type SeriesTransaction = Pick<InvoicingTransaction,
  "addDocumentSeries" | "findDocumentSeries" | "listDocumentSeries" | "setDocumentSeriesArchived" | "findLatestIssueDate"
  | "allocateDocumentNumber">

const documentSeriesFrom = (value: Row): DocumentSeries => ({
  organizationId: text(value, "organization_id"),
  documentType: text(value, "document_type") as DocumentSeries["documentType"],
  series: text(value, "series"),
  archived: booleanInteger(value, "archived"),
})

export const seriesTransactionAdapter = (client: TransactionClient): SeriesTransaction => ({
  addDocumentSeries: (documentSeries) => write("add document series", async () => {
    const existing = await client.query(
      "SELECT 1 FROM document_series WHERE organization_id = $1 AND document_type = $2 AND series = $3",
      [documentSeries.organizationId, documentSeries.documentType, documentSeries.series],
    )
    if (existing.rows.length > 0) {
      throw new DomainConflict({ code: "document_series_exists", message: "Document series already exists" })
    }
    await client.query(
      "INSERT INTO document_series (organization_id, document_type, series, archived) VALUES ($1, $2, $3, $4)",
      [documentSeries.organizationId, documentSeries.documentType, documentSeries.series, booleanValue(documentSeries.archived)],
    )
  }),
  findDocumentSeries: (organizationId, documentType, series) => read("find document series", async () => {
    const { rows } = await client.query(
      "SELECT * FROM document_series WHERE organization_id = $1 AND document_type = $2 AND series = $3",
      [organizationId, documentType, series],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : documentSeriesFrom(value)
  }),
  listDocumentSeries: (organizationId) => read("list document series", async () => {
    const { rows } = await client.query(
      "SELECT * FROM document_series WHERE organization_id = $1 ORDER BY document_type, series", [organizationId],
    )
    return rows.map(documentSeriesFrom)
  }),
  setDocumentSeriesArchived: (documentSeries) => write("set document series archived", async () => {
    const { rowCount } = await client.query(
      "UPDATE document_series SET archived = $4 WHERE organization_id = $1 AND document_type = $2 AND series = $3",
      [documentSeries.organizationId, documentSeries.documentType, documentSeries.series, booleanValue(documentSeries.archived)],
    )
    if (rowCount !== 1) throw new Error("document series to archive is missing")
  }),
  findLatestIssueDate: (organizationId, documentType, series) => read("find latest issue date", async () => {
    // The derived table needs a name on PostgreSQL; SQLite allowed it unnamed.
    const sql = documentType === "proforma"
      ? `SELECT MAX(issue_date) AS latest FROM proformas
          WHERE organization_id = $1 AND series = $2 AND sealed = 1`
      : `SELECT MAX(latest) AS latest FROM (
          SELECT MAX(issue_date) AS latest FROM issued_invoices WHERE organization_id = $1 AND series = $2
          UNION ALL SELECT MAX(issue_date) FROM correction_documents
            WHERE organization_id = $1 AND series = $2) AS issued_or_corrected`
    const { rows } = await client.query(sql, [organizationId, series])
    const value = firstRow(rows)
    return value === undefined ? undefined : optionalText(value, "latest")
  }),
  allocateDocumentNumber: (organizationId, documentType, series) =>
    write("allocate document number", async () => {
      // The allocation stays a transactional UPSERT, not a sequence: a sequence
      // would not roll back with the issuance that reserved the number.
      const { rows } = await client.query(
        `INSERT INTO invoice_sequences
          (organization_id, document_type, series, last_number) VALUES ($1, $2, $3, 1)
          ON CONFLICT (organization_id, document_type, series)
          DO UPDATE SET last_number = invoice_sequences.last_number + 1 RETURNING last_number`,
        [organizationId, documentType, series],
      )
      const value = firstRow(rows)
      if (value === undefined) throw new Error("missing allocated number")
      return integer(value, "last_number")
    }),
})
