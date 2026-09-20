import type { DatabaseSync } from "node:sqlite"

import type { ProformaSummary } from "../../cube/invoicing/index.ts"
import type { ProformaTransaction } from "../../cube/invoicing/issuance/index.ts"
import { read, row, rowsWanted, type Row } from "./sqlite-rows.ts"
import { withoutIssuerBranding } from "./sqlite-document-parties.ts"
import { documentKeyset, sourceFilter } from "./sqlite-document-query.ts"
import { proformaFrom } from "./sqlite-document-rows.ts"
import { saveProforma } from "./sqlite-proforma-writes.ts"

type ProformasTransaction = Pick<ProformaTransaction, "saveProforma" | "findProforma" | "listProformas">

export const proformasTransactionAdapter = (database: DatabaseSync): ProformasTransaction => ({
  saveProforma: (proforma) => saveProforma(database, proforma),
  findProforma: (organizationId, id) => read("find proforma", () => {
    const value = row(database.prepare(`SELECT p.*,c.resulting_draft_id AS converted_draft_id,
      COALESCE(i.resulting_invoice_id,di.id) AS converted_invoice_id FROM proformas p
      LEFT JOIN proforma_conversions c ON c.organization_id=p.organization_id AND c.proforma_id=p.id
      LEFT JOIN proforma_invoice_conversions i ON i.organization_id=p.organization_id AND i.proforma_id=p.id
      LEFT JOIN issued_invoices di ON di.organization_id=p.organization_id AND di.draft_id=c.resulting_draft_id AND di.source_proforma_id=p.id
      WHERE p.organization_id=? AND p.id=? AND p.sealed=1`).get(organizationId, id))
    return value === undefined ? undefined : proformaFrom(database, value)
  }),
  listProformas: (organizationId, page, source) => read("list proformas", () => {
    const filter = sourceFilter(source, "p.")
    const keyset = documentKeyset(page, "p.")
    return database.prepare(`SELECT p.id,p.source_draft_id,p.organization_id,p.source_app,p.source_kind,p.source_id,p.series,
      p.number,p.issue_date,p.due_date,p.issued_at,p.actor_id,p.currency,p.notes,p.issuer_legal_name,p.issuer_tax_identifier,
        p.issuer_country_code,p.issuer_city,p.issuer_street,p.issuer_county,p.issuer_sector,p.issuer_postal_code,p.issuer_legal_form,
       p.issuer_trade_registry_number,p.issuer_iban,p.issuer_bank_name,p.issuer_social_capital,p.issuer_vat_registered,NULL AS issuer_branding,
      p.customer_party_type,p.customer_legal_name,p.customer_tax_identifier,p.customer_country_code,p.customer_city,
       p.customer_street,p.customer_county,p.customer_sector,p.customer_postal_code,p.customer_vat_registered,p.total_excluding_tax,p.tax_total,p.total_including_tax,
      c.resulting_draft_id AS converted_draft_id,COALESCE(i.resulting_invoice_id,di.id) AS converted_invoice_id FROM proformas p
      LEFT JOIN proforma_conversions c ON c.organization_id=p.organization_id AND c.proforma_id=p.id
      LEFT JOIN proforma_invoice_conversions i ON i.organization_id=p.organization_id AND i.proforma_id=p.id
      LEFT JOIN issued_invoices di ON di.organization_id=p.organization_id AND di.draft_id=c.resulting_draft_id AND di.source_proforma_id=p.id
      WHERE p.organization_id=? AND p.sealed=1${filter.sql}${keyset.sql} ORDER BY p.issue_date DESC,p.number DESC,p.id LIMIT ?`)
      .all(organizationId, ...filter.values, ...keyset.values, rowsWanted(page))
      .map((value) => withoutIssuerBranding(proformaFrom(database, value as Row)) as ProformaSummary)
  }),
})
