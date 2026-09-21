import type { DatabaseSync } from "node:sqlite"

import type { InvoicingTransaction, IssuedInvoiceSummary } from "../../cube/invoicing/index.ts"
import { read, row, rowsWanted, write, type Row } from "./sqlite-rows.ts"
import { saveLines, vatTreatment } from "./sqlite-document-lines.ts"
import { withoutIssuerBranding } from "./sqlite-document-parties.ts"
import { documentKeyset, sourceFilter, sourceValues } from "./sqlite-document-query.ts"
import { issuedInvoiceFrom } from "./sqlite-document-rows.ts"

type InvoicesTransaction = Pick<InvoicingTransaction, "saveIssuedInvoice" | "findIssuedInvoice" | "listIssuedInvoices">

export const invoicesTransactionAdapter = (database: DatabaseSync): InvoicesTransaction => ({
  saveIssuedInvoice: (invoice) => write("save issued invoice", () => {
    database.prepare(`INSERT INTO issued_invoices
      (id, draft_id, source_proforma_id, organization_id, source_app, source_kind, source_id, fiscal_year, document_type, series, number, issue_date, due_date,
       issued_at, currency, issuer_legal_name, issuer_tax_identifier, issuer_country_code, issuer_city,
           issuer_street, issuer_county, issuer_sector, issuer_postal_code, issuer_legal_form, issuer_trade_registry_number, issuer_iban,
          issuer_bank_name, issuer_social_capital, issuer_vat_registered, issuer_branding, customer_legal_name, customer_tax_identifier, customer_party_type,
        customer_country_code, customer_city, customer_street, customer_county, customer_sector, customer_postal_code, customer_vat_registered,
         total_excluding_tax, tax_total, total_including_tax, e_factura_status, notes, actor_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(invoice.id, invoice.draftId, invoice.sourceProformaId, invoice.organizationId, ...sourceValues(invoice.source), Number(invoice.issueDate.slice(0, 4)),
        invoice.series, invoice.number, invoice.issueDate, invoice.dueDate, invoice.issuedAt, invoice.currency,
         invoice.issuer.name, invoice.issuer.fiscalIdentifier, invoice.issuer.address.countryCode, invoice.issuer.address.city,
         invoice.issuer.address.street, invoice.issuer.address.county, invoice.issuer.address.sector ?? null,
         invoice.issuer.address.postalCode ?? null, invoice.issuer.legalForm, invoice.issuer.tradeRegistryNumber, invoice.issuer.iban,
         invoice.issuer.bankName, invoice.issuer.socialCapital, Number(invoice.issuer.vatRegistered),
         invoice.issuer.branding === null ? null : JSON.stringify(invoice.issuer.branding),
         invoice.customer.name, invoice.customer.fiscalIdentifier, invoice.customer.partyType,
         invoice.customer.address.countryCode, invoice.customer.address.city, invoice.customer.address.street,
         invoice.customer.address.county, invoice.customer.address.sector ?? null, invoice.customer.address.postalCode ?? null,
         Number(invoice.customer.vatRegistered), invoice.totalExcludingVat, invoice.vatTotal, invoice.totalIncludingVat,
        (invoice as unknown as { eFacturaStatus?: string }).eFacturaStatus ?? "not_sent", invoice.notes, invoice.actorId)
    saveLines(database, { table: "issued_lines" }, invoice.id, invoice.lines)
    const statement = database.prepare(`INSERT INTO issued_tax_breakdown
      (invoice_id, line_position, tax_code, category, rate, vat_exemption_reason, taxable_amount, tax_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    invoice.vatBreakdown.forEach((tax, position) => {
      vatTreatment(tax.code, tax.rate, tax.vatCategoryCode, tax.vatExemptionReason)
      statement.run(invoice.id, position, tax.code, tax.vatCategoryCode, tax.rate, tax.vatExemptionReason,
        tax.vatBaseAmount, tax.vatAmount)
    })
  }),
  findIssuedInvoice: (organizationId, id) => read("find issued invoice", () => {
    const value = row(database.prepare("SELECT * FROM issued_invoices WHERE organization_id = ? AND id = ?").get(organizationId, id))
    return value === undefined ? undefined : issuedInvoiceFrom(database, value)
  }),
  listIssuedInvoices: (organizationId, page, source) => read("list issued invoices", () => {
    const filter = sourceFilter(source)
    const keyset = documentKeyset(page)
    return database.prepare(`SELECT id,draft_id,source_proforma_id,organization_id,source_app,source_kind,source_id,series,number,
      issue_date,due_date,issued_at,actor_id,currency,notes,issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,
        issuer_street,issuer_county,issuer_sector,issuer_postal_code,issuer_legal_form,issuer_trade_registry_number,issuer_iban,
       issuer_bank_name,issuer_social_capital,issuer_vat_registered,NULL AS issuer_branding,customer_legal_name,customer_tax_identifier,
       customer_party_type,customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,customer_vat_registered,
      total_excluding_tax,tax_total,total_including_tax,e_factura_status
      FROM issued_invoices WHERE organization_id = ?${filter.sql}${keyset.sql}
      ORDER BY issue_date DESC, number DESC, id LIMIT ?`).all(organizationId, ...filter.values, ...keyset.values, rowsWanted(page))
      .map((value) => withoutIssuerBranding(issuedInvoiceFrom(database, value as Row)) as IssuedInvoiceSummary)
  }),
})
