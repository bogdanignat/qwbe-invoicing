export interface InvoicingMigration {
  readonly name: string
  readonly statements: ReadonlyArray<string>
}

export const invoicingMigrations: ReadonlyArray<InvoicingMigration> = [{
  name: "001-invoice-core",
  statements: [
    `CREATE TABLE issuers (
      organization_id TEXT PRIMARY KEY, legal_name TEXT NOT NULL, tax_identifier TEXT NOT NULL,
      country_code TEXT NOT NULL, city TEXT NOT NULL, street TEXT NOT NULL, county TEXT, postal_code TEXT,
      default_currency TEXT NOT NULL, default_payment_term_days INTEGER NOT NULL,
      default_series TEXT NOT NULL
    ) STRICT`,
    `CREATE TABLE issuer_tax_configurations (
      organization_id TEXT NOT NULL, code TEXT NOT NULL, category TEXT NOT NULL,
      rate TEXT NOT NULL, effective_from TEXT NOT NULL, effective_to TEXT,
      PRIMARY KEY (organization_id, code, effective_from),
      FOREIGN KEY (organization_id) REFERENCES issuers (organization_id) ON DELETE CASCADE,
      CHECK (category = 'standard')
    ) STRICT`,
    `CREATE TABLE customers (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, legal_name TEXT NOT NULL,
      tax_identifier TEXT NOT NULL, country_code TEXT NOT NULL, city TEXT NOT NULL,
      street TEXT NOT NULL, county TEXT, postal_code TEXT,
      UNIQUE (organization_id, id)
    ) STRICT`,
    `CREATE TABLE invoice_drafts (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, customer_id TEXT NOT NULL,
      issue_date TEXT NOT NULL, due_date TEXT NOT NULL, currency TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft', 'issued')),
      UNIQUE (organization_id, id),
      FOREIGN KEY (organization_id, customer_id) REFERENCES customers (organization_id, id)
    ) STRICT`,
    `CREATE TABLE draft_lines (
      id TEXT PRIMARY KEY, draft_id TEXT NOT NULL, line_position INTEGER NOT NULL,
      description TEXT NOT NULL, quantity TEXT NOT NULL, unit_price TEXT NOT NULL,
      tax_code TEXT NOT NULL, tax_category TEXT NOT NULL, tax_rate TEXT NOT NULL,
      total_excluding_tax TEXT NOT NULL, tax_amount TEXT NOT NULL, total_including_tax TEXT NOT NULL,
      UNIQUE (draft_id, line_position), FOREIGN KEY (draft_id) REFERENCES invoice_drafts (id) ON DELETE CASCADE
    ) STRICT`,
    `CREATE TABLE invoice_sequences (
      organization_id TEXT NOT NULL, fiscal_year INTEGER NOT NULL, document_type TEXT NOT NULL,
      series TEXT NOT NULL, last_number INTEGER NOT NULL CHECK (last_number > 0),
      PRIMARY KEY (organization_id, fiscal_year, document_type, series)
    ) STRICT`,
    `CREATE TABLE issued_invoices (
      id TEXT PRIMARY KEY, draft_id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL, document_type TEXT NOT NULL, series TEXT NOT NULL,
      number INTEGER NOT NULL CHECK (number > 0), issue_date TEXT NOT NULL, due_date TEXT NOT NULL,
      issued_at TEXT NOT NULL, currency TEXT NOT NULL,
      issuer_legal_name TEXT NOT NULL, issuer_tax_identifier TEXT NOT NULL,
      issuer_country_code TEXT NOT NULL, issuer_city TEXT NOT NULL, issuer_street TEXT NOT NULL,
      issuer_county TEXT, issuer_postal_code TEXT,
      customer_legal_name TEXT NOT NULL, customer_tax_identifier TEXT NOT NULL,
      customer_country_code TEXT NOT NULL, customer_city TEXT NOT NULL, customer_street TEXT NOT NULL,
      customer_county TEXT, customer_postal_code TEXT,
      total_excluding_tax TEXT NOT NULL, tax_total TEXT NOT NULL, total_including_tax TEXT NOT NULL,
      UNIQUE (organization_id, fiscal_year, document_type, series, number),
      FOREIGN KEY (organization_id, draft_id) REFERENCES invoice_drafts (organization_id, id)
    ) STRICT`,
    `CREATE TABLE issued_lines (
      id TEXT NOT NULL, invoice_id TEXT NOT NULL, line_position INTEGER NOT NULL,
      description TEXT NOT NULL, quantity TEXT NOT NULL, unit_price TEXT NOT NULL,
      tax_code TEXT NOT NULL, tax_category TEXT NOT NULL, tax_rate TEXT NOT NULL,
      total_excluding_tax TEXT NOT NULL, tax_amount TEXT NOT NULL, total_including_tax TEXT NOT NULL,
      PRIMARY KEY (invoice_id, id), UNIQUE (invoice_id, line_position),
      FOREIGN KEY (invoice_id) REFERENCES issued_invoices (id)
    ) STRICT`,
    `CREATE TABLE issued_tax_breakdown (
      invoice_id TEXT NOT NULL, line_position INTEGER NOT NULL, tax_code TEXT NOT NULL,
      category TEXT NOT NULL, rate TEXT NOT NULL, taxable_amount TEXT NOT NULL, tax_amount TEXT NOT NULL,
      PRIMARY KEY (invoice_id, line_position), FOREIGN KEY (invoice_id) REFERENCES issued_invoices (id)
    ) STRICT`,
    `CREATE TRIGGER invoice_drafts_no_issued_update BEFORE UPDATE ON invoice_drafts
      WHEN OLD.status = 'issued' BEGIN SELECT RAISE(ABORT, 'issued drafts are immutable'); END`,
    `CREATE TRIGGER issued_invoices_no_update BEFORE UPDATE ON issued_invoices
      BEGIN SELECT RAISE(ABORT, 'issued invoices are immutable'); END`,
    `CREATE TRIGGER issued_invoices_no_delete BEFORE DELETE ON issued_invoices
      BEGIN SELECT RAISE(ABORT, 'issued invoices are immutable'); END`,
    `CREATE TRIGGER issued_lines_no_update BEFORE UPDATE ON issued_lines
      BEGIN SELECT RAISE(ABORT, 'issued invoice lines are immutable'); END`,
    `CREATE TRIGGER issued_lines_no_delete BEFORE DELETE ON issued_lines
      BEGIN SELECT RAISE(ABORT, 'issued invoice lines are immutable'); END`,
    `CREATE TRIGGER issued_tax_breakdown_no_update BEFORE UPDATE ON issued_tax_breakdown
      BEGIN SELECT RAISE(ABORT, 'issued tax breakdown is immutable'); END`,
    `CREATE TRIGGER issued_tax_breakdown_no_delete BEFORE DELETE ON issued_tax_breakdown
      BEGIN SELECT RAISE(ABORT, 'issued tax breakdown is immutable'); END`,
    "CREATE INDEX customers_organization ON customers (organization_id)",
    "CREATE INDEX drafts_organization_status ON invoice_drafts (organization_id, status)",
    "CREATE INDEX issued_organization ON issued_invoices (organization_id)",
  ],
}]
