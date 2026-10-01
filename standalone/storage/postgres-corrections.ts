import type { CorrectionsTransaction } from "../../cube/invoicing/corrections/index.ts"
import { read, write } from "./postgres-errors.ts"
import { addressColumns, addressValues, booleanValue, firstRow } from "./postgres-rows.ts"
import { fragments, insertStatement, pairs } from "./postgres-sql.ts"
import { correctionFrom } from "./postgres-correction-rows.ts"
import {
  breakdownColumns, breakdownValues, lineColumns, lineValues, vatTreatment,
} from "./postgres-document-lines.ts"
import { issuerColumns } from "./postgres-document-parties.ts"
import { sourceColumns, sourceFilter, sourceValues } from "./postgres-document-query.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type CorrectionDocumentsTransaction = Pick<CorrectionsTransaction,
  "saveCorrection" | "findCorrection" | "listCorrections">

const correctionColumns = [
  "id", "organization_id", ...sourceColumns(), "original_invoice_id", "fiscal_year", "document_type",
  "series", "number", "issue_date", "issued_at", "reason", "currency",
  "issuer_legal_name", "issuer_tax_identifier", ...addressColumns("issuer_"), ...issuerColumns(),
  "issuer_vat_registered",
  "customer_legal_name", "customer_tax_identifier", "customer_party_type", ...addressColumns("customer_"),
  "customer_vat_registered", "total_excluding_tax", "tax_total", "total_including_tax", "actor_id",
]

export const correctionsTransactionAdapter = (client: TransactionClient): CorrectionDocumentsTransaction => ({
  saveCorrection: (correction) => write("save correction", async () => {
    const statement = insertStatement("correction_documents", pairs(correctionColumns, [
      correction.id, correction.organizationId, ...sourceValues(correction.source),
      correction.originalInvoiceId, correction.fiscalYear, "correction",
      correction.series, correction.number, correction.issueDate, correction.issuedAt,
      correction.reason, correction.currency,
      correction.issuer.name, correction.issuer.fiscalIdentifier, ...addressValues(correction.issuer.address),
      correction.issuer.legalForm, correction.issuer.tradeRegistryNumber, correction.issuer.iban,
      correction.issuer.bankName, correction.issuer.socialCapital, booleanValue(correction.issuer.vatRegistered),
      correction.customer.name, correction.customer.fiscalIdentifier, correction.customer.partyType,
      ...addressValues(correction.customer.address), booleanValue(correction.customer.vatRegistered),
      correction.totalExcludingVat, correction.vatTotal, correction.totalIncludingVat, correction.actorId,
    ]))
    await client.query(statement.sql, statement.values)
    for (const [position, line] of correction.lines.entries()) {
      vatTreatment(line.vatRateCode, line.vatRate, line.vatCategoryCode, line.vatExemptionReason)
      const lineStatement = insertStatement("correction_lines", pairs(
        ["id", "correction_id", ...lineColumns], [line.id, correction.id, ...lineValues(position, line)],
      ))
      await client.query(lineStatement.sql, lineStatement.values)
    }
    for (const [position, tax] of correction.vatBreakdown.entries()) {
      vatTreatment(tax.code, tax.rate, tax.vatCategoryCode, tax.vatExemptionReason)
      const taxStatement = insertStatement("correction_tax_breakdown", pairs(
        ["correction_id", ...breakdownColumns], [correction.id, ...breakdownValues(position, tax)],
      ))
      await client.query(taxStatement.sql, taxStatement.values)
    }
  }),
  findCorrection: (organizationId, id) => read("find correction", async () => {
    const { rows } = await client.query(
      "SELECT * FROM correction_documents WHERE organization_id = $1 AND id = $2", [organizationId, id],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : await correctionFrom(client, value)
  }),
  listCorrections: (organizationId, originalInvoiceId, source) => read("list corrections", async () => {
    const filter = fragments(3, [(start) => sourceFilter(source, start)])
    const { rows } = await client.query(
      `SELECT * FROM correction_documents
        WHERE organization_id = $1 AND original_invoice_id = $2${filter.sql}
        ORDER BY issued_at, number, id`,
      [organizationId, originalInvoiceId, ...filter.values],
    )
    const corrections: Array<Awaited<ReturnType<typeof correctionFrom>>> = []
    for (const value of rows) corrections.push(await correctionFrom(client, value))
    return corrections
  }),
})
