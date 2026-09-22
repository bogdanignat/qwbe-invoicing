import type { DatabaseSync } from "node:sqlite"

import type { CorrectionsTransaction } from "../../cube/invoicing/corrections/index.ts"
import { addressValues, read, row, write, type Row } from "./sqlite-rows.ts"
import { correctionFrom } from "./sqlite-correction-rows.ts"
import { vatTreatment } from "./sqlite-document-lines.ts"
import { sourceFilter, sourceValues } from "./sqlite-document-query.ts"

type CorrectionDocumentsTransaction = Pick<CorrectionsTransaction, "saveCorrection" | "findCorrection" | "listCorrections">

export const correctionsTransactionAdapter = (database: DatabaseSync): CorrectionDocumentsTransaction => ({
  saveCorrection: (correction) => write("save correction", () => {
    database.prepare(`INSERT INTO correction_documents
      (id, organization_id, source_app, source_kind, source_id, original_invoice_id, fiscal_year, document_type, series, number, issue_date, issued_at, reason, currency,
         issuer_legal_name, issuer_tax_identifier, issuer_country_code, issuer_city, issuer_street, issuer_county, issuer_sector, issuer_postal_code,
         issuer_legal_form, issuer_trade_registry_number, issuer_iban, issuer_bank_name, issuer_social_capital, issuer_vat_registered,
         customer_legal_name, customer_tax_identifier, customer_party_type, customer_country_code, customer_city, customer_street, customer_county, customer_sector, customer_postal_code, customer_vat_registered,
       total_excluding_tax, tax_total, total_including_tax, actor_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'correction', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(correction.id, correction.organizationId, ...sourceValues(correction.source), correction.originalInvoiceId, correction.fiscalYear,
        correction.series, correction.number, correction.issueDate, correction.issuedAt, correction.reason, correction.currency,
         correction.issuer.name, correction.issuer.fiscalIdentifier, ...addressValues(correction.issuer.address),
         correction.issuer.legalForm, correction.issuer.tradeRegistryNumber, correction.issuer.iban,
         correction.issuer.bankName, correction.issuer.socialCapital, Number(correction.issuer.vatRegistered),
         correction.customer.name, correction.customer.fiscalIdentifier, correction.customer.partyType, ...addressValues(correction.customer.address),
         Number(correction.customer.vatRegistered), correction.totalExcludingVat, correction.vatTotal,
         correction.totalIncludingVat, correction.actorId)
    const lineStatement = database.prepare(`INSERT INTO correction_lines
      (id, correction_id, line_position, description, quantity, unit_price, unit_code, unit_name, tax_code, tax_category, tax_rate, vat_exemption_reason, total_excluding_tax, tax_amount, total_including_tax)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    correction.lines.forEach((line, position) => {
      vatTreatment(line.vatRateCode, line.vatRate, line.vatCategoryCode, line.vatExemptionReason)
      lineStatement.run(line.id, correction.id, position, line.description, line.quantity, line.unitPrice,
        line.unitOfMeasure.code, line.unitOfMeasure.name, line.vatRateCode, line.vatCategoryCode, line.vatRate,
        line.vatExemptionReason, line.totalExcludingVat, line.vatAmount, line.totalIncludingVat)
    })
    const taxStatement = database.prepare(`INSERT INTO correction_tax_breakdown
      (correction_id, line_position, tax_code, category, rate, vat_exemption_reason, taxable_amount, tax_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    correction.vatBreakdown.forEach((tax, position) => {
      vatTreatment(tax.code, tax.rate, tax.vatCategoryCode, tax.vatExemptionReason)
      taxStatement.run(correction.id, position, tax.code, tax.vatCategoryCode, tax.rate, tax.vatExemptionReason,
        tax.vatBaseAmount, tax.vatAmount)
    })
  }),
  findCorrection: (organizationId, id) => read("find correction", () => {
    const value = row(database.prepare("SELECT * FROM correction_documents WHERE organization_id = ? AND id = ?").get(organizationId, id))
    return value === undefined ? undefined : correctionFrom(database, value)
  }),
  listCorrections: (organizationId, originalInvoiceId, source) => read("list corrections", () => {
    const filter = sourceFilter(source)
    const rows = database.prepare(`SELECT * FROM correction_documents WHERE organization_id = ? AND original_invoice_id = ?${filter.sql}
      ORDER BY issued_at, number, id`).all(organizationId, originalInvoiceId, ...filter.values) as ReadonlyArray<Row>
    return rows.map((value) => correctionFrom(database, value))
  }),
})
