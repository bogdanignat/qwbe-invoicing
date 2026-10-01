/**
 * A populated schema, built with the SQL the application would send.
 *
 * Every row here is accepted by the translated baseline, so the seed itself is
 * the accept half of the parity matrix: if a translated CHECK, trigger or
 * foreign key were tightened by accident, seeding fails before a single reject
 * case runs.
 */

const ISSUER = `INSERT INTO issuers(organization_id,legal_name,tax_identifier,country_code,city,street,county,
  sector,postal_code,default_currency,default_payment_term_days,branding,legal_form,trade_registry_number,
  iban,bank_name,social_capital)
  VALUES('org-1','Furnizor SRL','12345674','RO','Iasi','Strada 1','RO-IS',NULL,NULL,'RON',15,
  '{"logo":"x"}','srl','J22/123/2020','RO49AAAA1B31007593840000','Banca','1000.00')`

const CUSTOMER = `INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,
  county,sector,postal_code,party_type,vat_registered,default_payment_term_days)
  VALUES('customer-1','org-1','Client SRL','87654329','RO','Iasi','Strada 2','RO-IS',NULL,NULL,'company',1,30)`

const draft = (id, status) => `INSERT INTO invoice_drafts(id,organization_id,customer_id,customer_party_type,
  customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,
  customer_county,customer_sector,customer_postal_code,customer_vat_registered,series,issue_date,due_date,
  currency,status,notes)
  VALUES('${id}','org-1','customer-1','company','Client SRL','87654329','RO','Iasi','Strada 2','RO-IS',
  NULL,NULL,1,'INV','2026-09-01',NULL,'RON','${status}','Observatie')`

const proforma = (id, number) => `INSERT INTO proformas(id,source_draft_id,organization_id,fiscal_year,
  document_type,series,number,issue_date,due_date,issued_at,currency,
  issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,
  issuer_sector,issuer_postal_code,customer_party_type,customer_legal_name,customer_tax_identifier,
  customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,
  customer_vat_registered,total_excluding_tax,tax_total,total_including_tax,sealed,issuer_branding,
  issuer_legal_form,issuer_trade_registry_number,issuer_iban,issuer_bank_name,issuer_social_capital,
  actor_id,issuer_vat_registered)
  VALUES('${id}',NULL,'org-1',2026,'proforma','PRO',${number},'2026-09-01',NULL,'2026-09-01T10:00:00.000Z','RON',
  'Furnizor SRL','12345674','RO','Iasi','Strada 1','RO-IS',NULL,NULL,
  'company','Client SRL','87654329','RO','Iasi','Strada 2','RO-IS',NULL,NULL,1,
  '100.00','21.00','121.00',0,NULL,'srl','J22/123/2020','RO49','Banca','1000.00','operator',1)`

const invoice = (id, draftId, proformaId, number) => `INSERT INTO issued_invoices(id,draft_id,organization_id,
  fiscal_year,document_type,series,number,issue_date,due_date,issued_at,currency,
  issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,
  issuer_sector,issuer_postal_code,customer_legal_name,customer_tax_identifier,customer_country_code,
  customer_city,customer_street,customer_county,customer_sector,customer_postal_code,
  total_excluding_tax,tax_total,total_including_tax,customer_party_type,customer_vat_registered,
  source_proforma_id,issuer_branding,issuer_legal_form,issuer_trade_registry_number,issuer_iban,
  issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered)
  VALUES('${id}',${draftId === null ? "NULL" : `'${draftId}'`},'org-1',2026,'invoice','INV',${number},
  '2026-09-01',NULL,'2026-09-01T10:00:00.000Z','RON',
  'Furnizor SRL','12345674','RO','Iasi','Strada 1','RO-IS',NULL,NULL,
  'Client SRL','87654329','RO','Iasi','Strada 2','RO-IS',NULL,NULL,
  '100.00','21.00','121.00','company',1,${proformaId === null ? "NULL" : `'${proformaId}'`},
  '{"logo":"x"}','srl','J22/123/2020','RO49','Banca','1000.00','operator',1)`

const TAX_LINE = "'Servicii','1.00','100.00','RO_STANDARD','S','21.00',NULL,'100.00','21.00','121.00','C62','unitate'"
const TAX_BREAKDOWN = "'RO_STANDARD','S','21.00',NULL,'100.00','21.00'"

/** Statements that must all succeed, in order. The accept half of the matrix. */
export const seedStatements = [
  ISSUER,
  `INSERT INTO issuer_tax_configurations(organization_id,code,category,rate,vat_exemption_reason,
     effective_from,effective_to) VALUES('org-1','RO_STANDARD','S','21.00',NULL,'2026-01-01',NULL)`,
  "INSERT INTO document_series VALUES('org-1','invoice','INV'),('org-1','proforma','PRO')",
  "INSERT INTO invoice_sequences VALUES('org-1',2026,'invoice','INV',3)",
  CUSTOMER,
  `INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name,
     preferred_vat_rate_code) VALUES('preset-1','org-1','Servicii','100.00','C62','unitate','RO_STANDARD')`,
  draft("draft-1", "issued"),
  draft("draft-2", "draft"),
  draft("draft-3", "draft"),
  `INSERT INTO draft_lines(id,draft_id,line_position,description,quantity,unit_price,tax_code,tax_category,
     tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax,unit_code,unit_name)
     VALUES('dl-1','draft-2',1,${TAX_LINE})`,
  proforma("pf-1", 1),
  proforma("pf-2", 2),
  proforma("pf-3", 3),
  `INSERT INTO proforma_lines(id,proforma_id,organization_id,line_position,description,quantity,unit_price,
     tax_code,tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax,
     unit_code,unit_name) VALUES('pl-1','pf-1','org-1',1,${TAX_LINE})`,
  `INSERT INTO proforma_tax_breakdown(proforma_id,organization_id,line_position,tax_code,category,rate,
     vat_exemption_reason,taxable_amount,tax_amount) VALUES('pf-1','org-1',1,${TAX_BREAKDOWN})`,
  // Sealing is the only permitted update on a proforma.
  "UPDATE proformas SET sealed=1 WHERE id IN('pf-1','pf-2','pf-3')",
  invoice("invoice-1", "draft-1", null, 1),
  `INSERT INTO issued_lines(id,invoice_id,line_position,description,quantity,unit_price,tax_code,tax_category,
     tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax,unit_code,unit_name)
     VALUES('il-1','invoice-1',1,${TAX_LINE})`,
  `INSERT INTO issued_tax_breakdown(invoice_id,line_position,tax_code,category,rate,vat_exemption_reason,
     taxable_amount,tax_amount) VALUES('invoice-1',1,${TAX_BREAKDOWN})`,
  // pf-2 converts to a draft; pf-3 converts straight to an invoice. The second
  // pair is the deferrable cycle: the invoice references the conversion row
  // that does not exist yet, and both land in the same transaction.
  `INSERT INTO proforma_conversions(proforma_id,organization_id,resulting_draft_id,actor_id,converted_at)
     VALUES('pf-2','org-1','draft-3','operator','2026-09-01T10:00:00.000Z')`,
  invoice("invoice-3", null, "pf-3", 3),
  `INSERT INTO proforma_invoice_conversions(proforma_id,organization_id,resulting_invoice_id,actor_id,
     converted_at) VALUES('pf-3','org-1','invoice-3','operator','2026-09-01T10:00:00.000Z')`,
  `INSERT INTO correction_documents(id,organization_id,original_invoice_id,fiscal_year,document_type,series,
     number,issue_date,issued_at,reason,currency,issuer_legal_name,issuer_tax_identifier,issuer_country_code,
     issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,customer_legal_name,
     customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,
     customer_sector,customer_postal_code,total_excluding_tax,tax_total,total_including_tax,
     customer_party_type,customer_vat_registered,issuer_legal_form,issuer_trade_registry_number,issuer_iban,
     issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered)
     VALUES('corr-1','org-1','invoice-1',2026,'correction','INV',1,'2026-09-02','2026-09-02T10:00:00.000Z',
     'Eroare','RON','Furnizor SRL','12345674','RO','Iasi','Strada 1','RO-IS',NULL,NULL,
     'Client SRL','87654329','RO','Iasi','Strada 2','RO-IS',NULL,NULL,'-100.00','-21.00','-121.00',
     'company',1,'srl','J22/123/2020','RO49','Banca','1000.00','operator',1)`,
  `INSERT INTO correction_lines(id,correction_id,line_position,description,quantity,unit_price,tax_code,
     tax_category,tax_rate,vat_exemption_reason,total_excluding_tax,tax_amount,total_including_tax,unit_code,
     unit_name) VALUES('cl-1','corr-1',1,${TAX_LINE})`,
  `INSERT INTO correction_tax_breakdown(correction_id,line_position,tax_code,category,rate,
     vat_exemption_reason,taxable_amount,tax_amount) VALUES('corr-1',1,${TAX_BREAKDOWN})`,
  `INSERT INTO audit_events(id,organization_id,actor_id,occurred_at,action,target_kind,target_id,reason)
     VALUES('ae-1','org-1','operator','2026-09-01T10:00:00.000Z','issue','invoice','invoice-1',NULL)`,
  `INSERT INTO idempotency_records(organization_id,idempotency_key,operation,fingerprint,result_kind,
     result_id,created_at) VALUES('org-1','key-1','issue_invoice_from_draft',
     'sha256:${"a".repeat(64)}','invoice','invoice-1','2026-09-01T10:00:00.000Z')`,
  `INSERT INTO invoice_payments(id,invoice_id,organization_id,amount,currency,payment_date,method,
     external_reference,note,actor_id,created_at,kind,reverses_payment_id)
     VALUES('pay-1','invoice-1','org-1','121.00','RON','2026-09-02','bank',NULL,NULL,'operator',
     '2026-09-02T10:00:00.000Z','payment',NULL)`,
  `INSERT INTO invoice_payments(id,invoice_id,organization_id,amount,currency,payment_date,method,
     external_reference,note,actor_id,created_at,kind,reverses_payment_id)
     VALUES('pay-2','invoice-1','org-1','-121.00','RON','2026-09-03','bank',NULL,NULL,'operator',
     '2026-09-03T10:00:00.000Z','reversal','pay-1')`,
  `INSERT INTO payment_idempotency_records(organization_id,idempotency_key,operation,fingerprint,result_id,
     created_at) VALUES('org-1','pay-key-1','record_payment','sha256:${"b".repeat(64)}','pay-1',
     '2026-09-02T10:00:00.000Z')`,
  `INSERT INTO invoice_artifacts(invoice_id,organization_id,object_key,sha256,byte_length,media_type,
     template_version,generated_at) VALUES('invoice-1','org-1','k/1','${"c".repeat(64)}',1024,
     'application/pdf','v1','2026-09-01T10:00:00.000Z')`,
  `INSERT INTO proforma_artifacts(proforma_id,organization_id,object_key,sha256,byte_length,media_type,
     template_version,generated_at) VALUES('pf-1','org-1','k/2','${"d".repeat(64)}',2048,
     'application/pdf','v1','2026-09-01T10:00:00.000Z')`,
  `INSERT INTO browser_sessions(session_hash,credential_hash,csrf_token,created_at,expires_at)
     VALUES('s1','c1','t1',1759000000000,1759003600000)`,
]

/** The statements the seed runs inside one transaction, by index range. */
export const deferredCycleRange = {
  from: seedStatements.findIndex((statement) => statement.includes("'invoice-3'")),
  to: seedStatements.findIndex((statement) => statement.includes("proforma_invoice_conversions(proforma_id")),
}
