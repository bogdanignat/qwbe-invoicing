/**
 * The reject half of the parity matrix: one case per translated trigger, plus
 * the constraint invariants the triggers do not cover.
 *
 * Every case names the trigger it exercises, so the list can be compared with
 * the triggers the database actually carries — a trigger without a case, or a
 * case without a trigger, is a gap the gate reports instead of hiding.
 */

const draftWith = (id, overrides) => {
  const base = {
    county: "'RO-IS'", sector: "NULL", series: "'INV'", status: "'draft'",
    sourceApp: "NULL", sourceKind: "NULL", sourceId: "NULL",
    ...overrides,
  }
  return `INSERT INTO invoice_drafts(id,organization_id,customer_id,customer_party_type,customer_legal_name,
    customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_sector,
    customer_postal_code,customer_vat_registered,series,issue_date,due_date,currency,status,
    source_app,source_kind,source_id)
    VALUES('${id}','org-1','customer-1','company','Client SRL','87654329','RO','Iasi','Strada 2',
    ${base.county},${base.sector},NULL,1,${base.series},'2026-09-01',NULL,'RON',${base.status},
    ${base.sourceApp},${base.sourceKind},${base.sourceId})`
}

const proformaWith = (id, number, overrides) => {
  const base = { issuerCounty: "'RO-IS'", issuerSector: "NULL", sourceApp: "NULL", ...overrides }
  return `INSERT INTO proformas(id,source_draft_id,organization_id,fiscal_year,document_type,series,number,
    issue_date,due_date,issued_at,currency,issuer_legal_name,issuer_tax_identifier,issuer_country_code,
    issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,customer_party_type,
    customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,
    customer_county,customer_sector,customer_postal_code,customer_vat_registered,total_excluding_tax,
    tax_total,total_including_tax,sealed,issuer_legal_form,issuer_trade_registry_number,issuer_iban,
    issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered,source_app,source_kind,source_id)
    VALUES('${id}',NULL,'org-1',2026,'proforma','PRO',${number},'2026-09-01',NULL,
    '2026-09-01T10:00:00.000Z','RON','Furnizor SRL','12345674','RO','Iasi','Strada 1',
    ${base.issuerCounty},${base.issuerSector},NULL,'company','Client SRL','87654329','RO','Iasi','Strada 2',
    'RO-IS',NULL,NULL,1,'100.00','21.00','121.00',0,'srl','J22/123/2020','RO49','Banca','1000.00',
    'operator',1,${base.sourceApp},NULL,NULL)`
}

const invoiceWith = (id, number, overrides) => {
  const base = {
    draftId: "NULL", proformaId: "NULL", issuerCounty: "'RO-IS'", issuerSector: "NULL", sourceApp: "NULL", ...overrides,
  }
  return `INSERT INTO issued_invoices(id,draft_id,organization_id,fiscal_year,document_type,series,number,
    issue_date,due_date,issued_at,currency,issuer_legal_name,issuer_tax_identifier,issuer_country_code,
    issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,customer_legal_name,
    customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
    customer_sector,customer_postal_code,total_excluding_tax,tax_total,total_including_tax,
    customer_party_type,customer_vat_registered,source_proforma_id,issuer_legal_form,
    issuer_trade_registry_number,issuer_iban,issuer_bank_name,issuer_social_capital,actor_id,
    issuer_vat_registered,source_app,source_kind,source_id)
    VALUES('${id}',${base.draftId},'org-1',2026,'invoice','INV',${number},'2026-09-01',NULL,
    '2026-09-01T10:00:00.000Z','RON','Furnizor SRL','12345674','RO','Iasi','Strada 1',
    ${base.issuerCounty},${base.issuerSector},NULL,'Client SRL','87654329','RO','Iasi','Strada 2',
    'RO-IS',NULL,NULL,'100.00','21.00','121.00','company',1,${base.proformaId},'srl','J22/123/2020',
    'RO49','Banca','1000.00','operator',1,${base.sourceApp},NULL,NULL)`
}

const correctionWith = (id, number, overrides) => {
  const base = { issuerCounty: "'RO-IS'", issuerSector: "NULL", sourceApp: "NULL", ...overrides }
  return `INSERT INTO correction_documents(id,organization_id,original_invoice_id,fiscal_year,document_type,
    series,number,issue_date,issued_at,reason,currency,issuer_legal_name,issuer_tax_identifier,
    issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,
    customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,
    customer_county,customer_sector,customer_postal_code,total_excluding_tax,tax_total,total_including_tax,
    customer_party_type,customer_vat_registered,issuer_legal_form,issuer_trade_registry_number,issuer_iban,
    issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered,source_app,source_kind,source_id)
    VALUES('${id}','org-1','invoice-1',2026,'correction','INV',${number},'2026-09-02',
    '2026-09-02T10:00:00.000Z','Eroare','RON','Furnizor SRL','12345674','RO','Iasi','Strada 1',
    ${base.issuerCounty},${base.issuerSector},NULL,'Client SRL','87654329','RO','Iasi','Strada 2',
    'RO-IS',NULL,NULL,'-100.00','-21.00','-121.00','company',1,'srl','J22/123/2020','RO49','Banca',
    '1000.00','operator',1,${base.sourceApp},NULL,NULL)`
}

const LINE_TAIL = "'Servicii','1.00','100.00','RO_STANDARD','S','21.00',NULL,'100.00','21.00','121.00','C62','unitate'"

/** trigger name -> a statement the trigger must refuse, and the message it raises. */
export const triggerRejections = [
  ["proforma_conversions_no_update", "UPDATE proforma_conversions SET actor_id='x' WHERE proforma_id='pf-2'",
    "proforma conversions are immutable"],
  ["proforma_conversions_no_delete", "DELETE FROM proforma_conversions WHERE proforma_id='pf-2'",
    "proforma conversions are immutable"],
  ["proforma_invoice_conversions_no_update",
    "UPDATE proforma_invoice_conversions SET actor_id='x' WHERE proforma_id='pf-3'",
    "proforma invoice conversions are immutable"],
  ["proforma_invoice_conversions_no_delete", "DELETE FROM proforma_invoice_conversions WHERE proforma_id='pf-3'",
    "proforma invoice conversions are immutable"],
  ["audit_events_no_update", "UPDATE audit_events SET action='x' WHERE id='ae-1'", "audit events are append-only"],
  ["audit_events_no_delete", "DELETE FROM audit_events WHERE id='ae-1'", "audit events are append-only"],
  ["idempotency_records_no_update", "UPDATE idempotency_records SET result_id='x' WHERE idempotency_key='key-1'",
    "idempotency record is immutable"],
  ["idempotency_records_no_delete", "DELETE FROM idempotency_records WHERE idempotency_key='key-1'",
    "idempotency record is immutable"],
  // The predicate moved into the function body: draft-1 is already issued.
  ["proforma_conversions_require_lineage",
    `INSERT INTO proforma_conversions(proforma_id,organization_id,resulting_draft_id,actor_id,converted_at)
     VALUES('pf-1','org-1','draft-1','operator','2026-09-01T10:00:00.000Z')`,
    "invalid proforma draft conversion lineage"],
  ["proforma_invoice_conversions_match",
    `INSERT INTO proforma_invoice_conversions(proforma_id,organization_id,resulting_invoice_id,actor_id,
     converted_at) VALUES('pf-2','org-1','invoice-1','operator','2026-09-01T10:00:00.000Z')`,
    "proforma invoice conversion does not match"],
  ["invoice_drafts_no_issued_update", "UPDATE invoice_drafts SET notes='x' WHERE id='draft-1'",
    "issued drafts are immutable"],
  ["invoice_drafts_no_issued_delete", "DELETE FROM invoice_drafts WHERE id='draft-1'",
    "issued drafts are immutable"],
  ["invoice_drafts_series_insert", draftWith("draft-bad-series", { series: "'ZZZ'" }),
    "invoice document series is not configured"],
  ["invoice_drafts_series_update", "UPDATE invoice_drafts SET series='PRO' WHERE id='draft-2'",
    "invoice draft series is immutable"],
  ["invoice_drafts_source_insert", draftWith("draft-bad-source", { sourceApp: "'crm'" }), "invalid draft source"],
  ["invoice_drafts_source_update", "UPDATE invoice_drafts SET source_app='crm' WHERE id='draft-2'",
    "invalid draft source"],
  ["invoice_drafts_bucharest_sector_insert", draftWith("draft-bad-sector", { county: "'RO-B'" }),
    "Bucharest sector is required"],
  ["invoice_drafts_bucharest_sector_update",
    "UPDATE invoice_drafts SET customer_county='RO-B',customer_sector=NULL WHERE id='draft-2'",
    "Bucharest sector is required"],
  ["proformas_seal_only", "UPDATE proformas SET sealed=0 WHERE id='pf-1'", "proformas are immutable"],
  ["proformas_no_content_update", "UPDATE proformas SET notes='x' WHERE id='pf-1'", "proformas are immutable"],
  ["proformas_no_delete", "DELETE FROM proformas WHERE id='pf-1'", "proformas are immutable"],
  ["proformas_source_insert", proformaWith("pf-bad-source", 9, { sourceApp: "'crm'" }), "invalid proforma source"],
  ["proformas_source_no_update", "UPDATE proformas SET source_app='crm' WHERE id='pf-1'",
    "proforma source is immutable"],
  ["proformas_actor_no_update", "UPDATE proformas SET actor_id='x' WHERE id='pf-1'",
    "proforma actor is immutable"],
  ["proformas_bucharest_sector_insert",
    proformaWith("pf-bad-sector", 8, { issuerCounty: "'RO-B'" }), "Bucharest sector is required"],
  ["issued_invoices_lineage_insert", invoiceWith("inv-bad-lineage", 9, { proformaId: "'pf-2'" }),
    "invalid invoice proforma lineage"],
  ["issued_invoices_no_update", "UPDATE issued_invoices SET notes='x' WHERE id='invoice-1'",
    "issued invoices are immutable except e_factura_status"],
  ["issued_invoices_no_delete", "DELETE FROM issued_invoices WHERE id='invoice-1'",
    "issued invoices are immutable"],
  ["issued_invoices_source_insert", invoiceWith("inv-bad-source", 8, { sourceApp: "'crm'" }),
    "invalid invoice source"],
  ["issued_invoices_source_no_update", "UPDATE issued_invoices SET source_app='crm' WHERE id='invoice-1'",
    "issued invoice source is immutable"],
  ["issued_invoices_actor_no_update", "UPDATE issued_invoices SET actor_id='x' WHERE id='invoice-1'",
    "issued invoice actor is immutable"],
  ["issued_invoices_bucharest_sector_insert", invoiceWith("inv-bad-sector", 7, { issuerCounty: "'RO-B'" }),
    "Bucharest sector is required"],
  ["correction_documents_no_update", "UPDATE correction_documents SET reason='x' WHERE id='corr-1'",
    "correction documents are immutable"],
  ["correction_documents_no_delete", "DELETE FROM correction_documents WHERE id='corr-1'",
    "correction documents are immutable"],
  ["correction_documents_source_insert", correctionWith("corr-bad-source", 9, { sourceApp: "'crm'" }),
    "invalid correction source"],
  ["correction_documents_actor_no_update", "UPDATE correction_documents SET actor_id='x' WHERE id='corr-1'",
    "correction actor is immutable"],
  ["correction_documents_bucharest_sector_insert",
    correctionWith("corr-bad-sector", 8, { issuerCounty: "'RO-B'" }), "Bucharest sector is required"],
  ["issued_lines_no_update", "UPDATE issued_lines SET description='x' WHERE id='il-1'",
    "issued invoice lines are immutable"],
  ["issued_lines_no_delete", "DELETE FROM issued_lines WHERE id='il-1'", "issued invoice lines are immutable"],
  ["issued_tax_breakdown_no_update", "UPDATE issued_tax_breakdown SET rate='19.00' WHERE invoice_id='invoice-1'",
    "issued tax breakdown is immutable"],
  ["issued_tax_breakdown_no_delete", "DELETE FROM issued_tax_breakdown WHERE invoice_id='invoice-1'",
    "issued tax breakdown is immutable"],
  ["proforma_lines_no_late_insert",
    `INSERT INTO proforma_lines(id,proforma_id,organization_id,line_position,description,quantity,unit_price,
     tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax,
     unit_code,unit_name) VALUES('pl-late','pf-1','org-1',2,${LINE_TAIL})`,
    "proforma lines are sealed"],
  ["proforma_lines_no_update", "UPDATE proforma_lines SET description='x' WHERE id='pl-1'",
    "proforma lines are immutable"],
  ["proforma_lines_no_delete", "DELETE FROM proforma_lines WHERE id='pl-1'", "proforma lines are immutable"],
  ["proforma_tax_no_late_insert",
    `INSERT INTO proforma_tax_breakdown(proforma_id,organization_id,line_position,tax_code,category,rate,
     vat_exemption_reason,taxable_amount,tax_amount)
     VALUES('pf-1','org-1',2,'RO_STANDARD','S','21.00',NULL,'100.00','21.00')`,
    "proforma tax breakdown is sealed"],
  ["proforma_tax_breakdown_no_update", "UPDATE proforma_tax_breakdown SET rate='19.00' WHERE proforma_id='pf-1'",
    "proforma tax breakdown is immutable"],
  ["proforma_tax_breakdown_no_delete", "DELETE FROM proforma_tax_breakdown WHERE proforma_id='pf-1'",
    "proforma tax breakdown is immutable"],
  ["correction_lines_no_update", "UPDATE correction_lines SET description='x' WHERE id='cl-1'",
    "correction lines are immutable"],
  ["correction_lines_no_delete", "DELETE FROM correction_lines WHERE id='cl-1'",
    "correction lines are immutable"],
  ["correction_tax_breakdown_no_update",
    "UPDATE correction_tax_breakdown SET rate='19.00' WHERE correction_id='corr-1'",
    "correction tax breakdown is immutable"],
  ["correction_tax_breakdown_no_delete", "DELETE FROM correction_tax_breakdown WHERE correction_id='corr-1'",
    "correction tax breakdown is immutable"],
  ["invoice_payments_reversal_shape",
    `INSERT INTO invoice_payments(id,invoice_id,organization_id,amount,currency,payment_date,method,actor_id,
     created_at,kind,reverses_payment_id) VALUES('pay-bad','invoice-1','org-1','1.00','RON','2026-09-04',
     'bank','operator','2026-09-04T10:00:00.000Z','reversal',NULL)`,
    "a reversal references exactly one payment"],
  ["invoice_payments_no_update", "UPDATE invoice_payments SET amount='1.00' WHERE id='pay-1'",
    "payments are immutable"],
  ["invoice_payments_no_delete", "DELETE FROM invoice_payments WHERE id='pay-1'", "payments are immutable"],
  ["payment_idempotency_records_no_update",
    "UPDATE payment_idempotency_records SET result_id='x' WHERE idempotency_key='pay-key-1'",
    "payment idempotency record is immutable"],
  ["payment_idempotency_records_no_delete",
    "DELETE FROM payment_idempotency_records WHERE idempotency_key='pay-key-1'",
    "payment idempotency record is immutable"],
  ["invoice_artifacts_no_update", "UPDATE invoice_artifacts SET object_key='x' WHERE invoice_id='invoice-1'",
    "invoice artifacts are immutable"],
  ["invoice_artifacts_no_delete", "DELETE FROM invoice_artifacts WHERE invoice_id='invoice-1'",
    "invoice artifacts are immutable"],
  ["proforma_artifacts_no_update", "UPDATE proforma_artifacts SET object_key='x' WHERE proforma_id='pf-1'",
    "proforma artifacts are immutable"],
  ["proforma_artifacts_no_delete", "DELETE FROM proforma_artifacts WHERE proforma_id='pf-1'",
    "proforma artifacts are immutable"],
]

/** Writes that must be accepted: the mutations the domain really performs. */
export const acceptedWrites = [
  ["issued invoice e-Factura status", "UPDATE issued_invoices SET e_factura_status='pending' WHERE id='invoice-1'"],
  ["draft notes cleared", "UPDATE invoice_drafts SET notes=NULL WHERE id='draft-2'"],
  ["customer soft delete", "UPDATE customers SET deleted_at='2026-09-10' WHERE id='customer-1'"],
  ["sequence advance", "UPDATE invoice_sequences SET last_number=4 WHERE organization_id='org-1'"],
  ["session expiry refresh", "UPDATE browser_sessions SET expires_at=1759007200000 WHERE session_hash='s1'"],
]

/** Constraint invariants the triggers do not cover, with the SQLSTATE expected. */
export const constraintCases = [
  ["generated column is not writable", "428C9",
    "UPDATE issued_invoices SET direct_source_proforma_id='x' WHERE id='invoice-1'"],
  ["foreign key to an absent invoice", "23503",
    `INSERT INTO invoice_payments(id,invoice_id,organization_id,amount,currency,payment_date,method,actor_id,
     created_at) VALUES('pay-x','absent','org-1','1.00','RON','2026-09-04','bank','operator','t')`],
  ["unique organization series number", "23505",
    `INSERT INTO document_series VALUES('org-1','invoice','INV')`],
  ["not null issuer legal name", "23502",
    `INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,
     party_type,vat_registered) VALUES('c-x','org-1',NULL,'1','RO','X','Y','RO-IS','company',0)`],
  ["check: individual cannot be VAT registered", "23514",
    `INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,
     party_type,vat_registered) VALUES('c-y','org-1','Ion','1','RO','X','Y','RO-IS','individual',1)`],
  ["check: sector outside Bucharest", "23514",
    `INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,
     sector,party_type,vat_registered) VALUES('c-z','org-1','X','1','RO','X','Y','RO-IS',1,'company',0)`],
  ["check: tax matrix rejects a mismatched rate", "23514",
    `INSERT INTO draft_lines(id,draft_id,line_position,description,quantity,unit_price,tax_code,tax_category,
     tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax,unit_code,unit_name)
     VALUES('dl-bad','draft-2',9,'Servicii','1.00','100.00','RO_STANDARD','S','5.00',NULL,'100.00','5.00',
     '105.00','C62','unitate')`],
  ["check: artifact byte length must be positive", "23514",
    `INSERT INTO invoice_artifacts(invoice_id,organization_id,object_key,sha256,byte_length,media_type,
     template_version,generated_at) VALUES('invoice-3','org-1','k/9','x',0,'application/pdf','v1','t')`],
]
