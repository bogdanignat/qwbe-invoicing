import type { DatabaseSync } from "node:sqlite"

import type { Proforma } from "../../cube/invoicing/index.ts"
import { write } from "./sqlite-rows.ts"
import { saveLines, vatTreatment } from "./sqlite-document-lines.ts"
import { sourceValues } from "./sqlite-document-query.ts"

export const saveProforma = (database: DatabaseSync, proforma: Proforma) => write("save proforma", () => {
  database.prepare(`INSERT INTO proformas
    (id,source_draft_id,organization_id,source_app,source_kind,source_id,fiscal_year,document_type,series,number,issue_date,due_date,issued_at,currency,
       issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,
      issuer_legal_form,issuer_trade_registry_number,issuer_iban,issuer_bank_name,issuer_social_capital,issuer_vat_registered,issuer_branding,
      customer_party_type,customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,customer_vat_registered,
          total_excluding_tax,tax_total,total_including_tax,notes,actor_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(proforma.id, proforma.sourceDraftId, proforma.organizationId, ...sourceValues(proforma.source), Number(proforma.issueDate.slice(0, 4)), "proforma",
      proforma.series, proforma.number, proforma.issueDate, proforma.dueDate, proforma.issuedAt, proforma.currency,
       proforma.issuer.name, proforma.issuer.fiscalIdentifier, proforma.issuer.address.countryCode, proforma.issuer.address.city,
       proforma.issuer.address.street, proforma.issuer.address.county, proforma.issuer.address.sector ?? null,
       proforma.issuer.address.postalCode ?? null, proforma.issuer.legalForm, proforma.issuer.tradeRegistryNumber, proforma.issuer.iban,
       proforma.issuer.bankName, proforma.issuer.socialCapital, Number(proforma.issuer.vatRegistered),
       proforma.issuer.branding === null ? null : JSON.stringify(proforma.issuer.branding), proforma.customer.partyType,
       proforma.customer.name, proforma.customer.fiscalIdentifier, proforma.customer.address.countryCode,
       proforma.customer.address.city, proforma.customer.address.street, proforma.customer.address.county,
       proforma.customer.address.sector ?? null, proforma.customer.address.postalCode ?? null,
       Number(proforma.customer.vatRegistered), proforma.totalExcludingVat, proforma.vatTotal,
       proforma.totalIncludingVat, proforma.notes, proforma.actorId)
  saveLines(database, { table: "proforma_lines", organizationId: proforma.organizationId }, proforma.id, proforma.lines)
  const statement = database.prepare(`INSERT INTO proforma_tax_breakdown
    (proforma_id,organization_id,line_position,tax_code,category,rate,vat_exemption_reason,taxable_amount,tax_amount) VALUES(?,?,?,?,?,?,?,?,?)`)
  proforma.vatBreakdown.forEach((tax, position) => {
    vatTreatment(tax.code, tax.rate, tax.vatCategoryCode, tax.vatExemptionReason)
    statement.run(proforma.id, proforma.organizationId, position, tax.code, tax.vatCategoryCode, tax.rate,
      tax.vatExemptionReason, tax.vatBaseAmount, tax.vatAmount)
  })
  database.prepare("UPDATE proformas SET sealed=1 WHERE id=? AND organization_id=? AND sealed=0")
    .run(proforma.id, proforma.organizationId)
})
