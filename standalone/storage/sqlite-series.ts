import type { DatabaseSync } from "node:sqlite"

import { DomainConflict, type DocumentSeries, type InvoicingTransaction } from "../../cube/invoicing/index.ts"
import { integer, optionalText, read, row, text, write, type Row } from "./sqlite-rows.ts"

type SeriesTransaction = Pick<InvoicingTransaction,
  "addDocumentSeries" | "findDocumentSeries" | "listDocumentSeries" | "findLatestIssueDate" | "allocateDocumentNumber">

const documentSeriesFrom = (value: Row): DocumentSeries => ({
  organizationId: text(value, "organization_id"),
  documentType: text(value, "document_type") as DocumentSeries["documentType"],
  series: text(value, "series"),
})

export const seriesTransactionAdapter = (database: DatabaseSync): SeriesTransaction => ({
  addDocumentSeries: (documentSeries) => write("add document series", () => {
    const existing = database.prepare(`SELECT 1 FROM document_series
      WHERE organization_id = ? AND document_type = ? AND series = ?`).get(
      documentSeries.organizationId, documentSeries.documentType, documentSeries.series,
    )
    if (existing !== undefined) {
      throw new DomainConflict({ code: "document_series_exists", message: "Document series already exists" })
    }
    database.prepare(`INSERT INTO document_series (organization_id, document_type, series)
      VALUES (?, ?, ?)`).run(documentSeries.organizationId, documentSeries.documentType, documentSeries.series)
  }),
  findDocumentSeries: (organizationId, documentType, series) => read("find document series", () => {
    const value = row(database.prepare(`SELECT * FROM document_series
      WHERE organization_id = ? AND document_type = ? AND series = ?`).get(organizationId, documentType, series))
    return value === undefined ? undefined : documentSeriesFrom(value)
  }),
  listDocumentSeries: (organizationId) => read("list document series", () =>
    database.prepare(`SELECT * FROM document_series WHERE organization_id = ?
      ORDER BY document_type, series`).all(organizationId).map((value) => documentSeriesFrom(value as Row))),
  findLatestIssueDate: (organizationId, fiscalYear, documentType, series) => read("find latest issue date", () => {
    const sql = documentType === "proforma"
      ? "SELECT MAX(issue_date) AS latest FROM proformas WHERE organization_id = ? AND fiscal_year = ? AND series = ? AND sealed = 1"
      : `SELECT MAX(latest) AS latest FROM (
          SELECT MAX(issue_date) AS latest FROM issued_invoices WHERE organization_id = ? AND fiscal_year = ? AND series = ?
          UNION ALL SELECT MAX(issue_date) FROM correction_documents WHERE organization_id = ? AND fiscal_year = ? AND series = ?)`
    const values = documentType === "proforma" ? [organizationId, fiscalYear, series] : [organizationId, fiscalYear, series, organizationId, fiscalYear, series]
    const value = row(database.prepare(sql).get(...values))
    return value === undefined ? undefined : optionalText(value, "latest")
  }),
  allocateDocumentNumber: (organizationId, fiscalYear, documentType, series) => write("allocate document number", () => {
    const value = row(database.prepare(`INSERT INTO invoice_sequences
      (organization_id, fiscal_year, document_type, series, last_number) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT (organization_id, fiscal_year, document_type, series)
      DO UPDATE SET last_number=last_number+1 RETURNING last_number`).get(organizationId, fiscalYear, documentType, series))
    if (value === undefined) throw new Error("missing allocated number")
    return integer(value, "last_number")
  }),
})
