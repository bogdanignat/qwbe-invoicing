import type { InvoicingMigration } from "./migration-types.ts"

export const invoicingEvolutionMigrations: ReadonlyArray<InvoicingMigration> = [{
  name: "004-invoice-delete-last",
  statements: [
    "ALTER TABLE issued_invoices ADD COLUMN e_factura_status TEXT NOT NULL DEFAULT 'not_sent' CHECK(e_factura_status IN('not_sent','pending','sent','accepted','rejected'))",
    "DROP TRIGGER invoice_drafts_no_issued_update",
    "DROP TRIGGER issued_invoices_no_delete",
    "DROP TRIGGER issued_lines_no_delete",
    "DROP TRIGGER issued_tax_breakdown_no_delete",
  ],
}, {
  name: "005-allow-e-factura-status-update",
  statements: [
    "DROP TRIGGER issued_invoices_no_update",
    "CREATE TRIGGER issued_invoices_no_update BEFORE UPDATE ON issued_invoices WHEN OLD.id != NEW.id OR OLD.draft_id != NEW.draft_id OR OLD.organization_id != NEW.organization_id OR OLD.fiscal_year != NEW.fiscal_year OR OLD.document_type != NEW.document_type OR OLD.series != NEW.series OR OLD.number != NEW.number OR OLD.issue_date != NEW.issue_date OR OLD.due_date != NEW.due_date OR OLD.issued_at != NEW.issued_at OR OLD.currency != NEW.currency OR OLD.issuer_legal_name != NEW.issuer_legal_name OR OLD.issuer_tax_identifier != NEW.issuer_tax_identifier OR OLD.issuer_country_code != NEW.issuer_country_code OR OLD.issuer_city != NEW.issuer_city OR OLD.issuer_street != NEW.issuer_street OR OLD.issuer_county != NEW.issuer_county OR OLD.issuer_postal_code != NEW.issuer_postal_code OR OLD.customer_legal_name != NEW.customer_legal_name OR OLD.customer_tax_identifier != NEW.customer_tax_identifier OR OLD.customer_country_code != NEW.customer_country_code OR OLD.customer_city != NEW.customer_city OR OLD.customer_street != NEW.customer_street OR OLD.customer_county != NEW.customer_county OR OLD.customer_postal_code != NEW.customer_postal_code OR OLD.total_excluding_tax != NEW.total_excluding_tax OR OLD.tax_total != NEW.tax_total OR OLD.total_including_tax != NEW.total_including_tax BEGIN SELECT RAISE(ABORT,'issued invoices are immutable except e_factura_status');END",
  ],
}, {
  name: "006-customer-soft-delete",
  statements: [
    "ALTER TABLE customers ADD COLUMN deleted_at TEXT",
    "CREATE INDEX customers_active_organization ON customers(organization_id,deleted_at,legal_name)",
  ],
}]
