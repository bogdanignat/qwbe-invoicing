import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { invoicingMigrations } from "../cube/invoicing/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"

const seedVersionSix = (directory: string) => {
  const database = new DatabaseSync(databasePath(directory))
  try {
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)STRICT")
    database.prepare("INSERT INTO schema_migrations(name,applied_at)VALUES('000-foundation','2026-01-01')").run()
    for (const migration of invoicingMigrations.filter(({ name }) => name <= "006-customer-soft-delete")) {
      for (const statement of migration.statements) database.exec(statement)
      database.prepare("INSERT INTO schema_migrations(name,applied_at)VALUES(?,?)").run(migration.name, "2026-01-01")
    }
    database.exec(`
      INSERT INTO issuers VALUES('org-1','Furnizor SRL','RO12345674','RO','Iași','Strada 1',NULL,'700000','RON',15);
      INSERT INTO issuer_tax_configurations VALUES('org-1','RO_STANDARD','standard','21.00','2025-08-01',NULL);
      INSERT INTO document_series VALUES('org-1','invoice','QWBE');
      INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,postal_code,deleted_at)
        VALUES('company','org-1','Companie SRL','RO87654329','RO','Iași','Strada 2',NULL,NULL,NULL),
              ('person','org-1','Ion Popescu','','RO','Cluj','Strada 3',NULL,NULL,NULL);
      INSERT INTO invoice_drafts VALUES('draft-issued','org-1','company','QWBE','2026-09-01','2026-09-16','RON','issued'),
        ('draft-open','org-1','person','QWBE','2026-09-02','2026-09-17','RON','draft');
      INSERT INTO draft_lines VALUES('line-1','draft-issued',0,'Servicii','1.0000','100.00','RO_STANDARD','standard','21.00','100.00','21.00','121.00');
      INSERT INTO invoice_sequences VALUES('org-1',2026,'invoice','QWBE',7);
      INSERT INTO issued_invoices(id,draft_id,organization_id,fiscal_year,document_type,series,number,issue_date,due_date,issued_at,currency,
        issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_postal_code,
        customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_postal_code,
        total_excluding_tax,tax_total,total_including_tax)
        VALUES('invoice-1','draft-issued','org-1',2026,'invoice','QWBE',7,'2026-09-01','2026-09-16','2026-09-01T10:00:00.000Z','RON',
        'Furnizor SRL','RO12345674','RO','Iași','Strada 1',NULL,'700000','Ion Popescu','','RO','Cluj','Strada 3',NULL,NULL,'100.00','21.00','121.00');
      INSERT INTO issued_lines VALUES('line-1','invoice-1',0,'Servicii','1.0000','100.00','RO_STANDARD','standard','21.00','100.00','21.00','121.00');
      INSERT INTO issued_tax_breakdown VALUES('invoice-1',0,'RO_STANDARD','standard','21.00','100.00','21.00');
      INSERT INTO invoice_payments VALUES('payment-1','invoice-1','org-1','20.00','RON','2026-09-02','transfer',NULL,NULL,'user-1','2026-09-02T10:00:00.000Z');
      INSERT INTO correction_documents(id,organization_id,original_invoice_id,fiscal_year,document_type,series,number,issue_date,issued_at,reason,currency,
        issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_postal_code,
        customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_postal_code,
        total_excluding_tax,tax_total,total_including_tax)
        VALUES('correction-1','org-1','invoice-1',2026,'correction','QWBE-C',1,'2026-09-03','2026-09-03T10:00:00.000Z','Corecție','RON',
        'Furnizor SRL','RO12345674','RO','Iași','Strada 1',NULL,'700000','Ion Popescu','','RO','Cluj','Strada 3',NULL,NULL,'-100.00','-21.00','-121.00');
    `)
  } finally {
    database.close()
  }
}

void test("upgrades a populated version-six database without rewriting migration history", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-upgrade-"))
  try {
    seedVersionSix(directory)
    assert.equal(applyMigrations(directory).changed, 4)
    const database = new DatabaseSync(databasePath(directory))
    try {
      database.exec("PRAGMA foreign_keys = ON")
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
      const migrations = database.prepare("SELECT name FROM schema_migrations ORDER BY name").all()
        .map((row) => row.name)
      assert.deepEqual(migrations, ["000-foundation", "001-invoice-core", "002-invoice-payments", "003-invoice-corrections",
        "004-invoice-delete-last", "005-allow-e-factura-status-update", "006-customer-soft-delete", "007-complete-invoice-authoring"])
      const columns = database.prepare("PRAGMA table_info(invoice_drafts)").all()
      assert.equal(columns.some((row) => row.name === "customer_id" && row.notnull === 0), true)
      assert.equal(database.prepare("PRAGMA foreign_key_list(invoice_drafts)").all().some((row) => row.table === "customers"), true)
      assert.equal(database.prepare("PRAGMA foreign_key_list(draft_lines)").all().some((row) => row.table === "invoice_drafts"), true)
      assert.equal(database.prepare("SELECT customer_party_type FROM invoice_drafts WHERE id='draft-open'").get()?.customer_party_type, "individual")
      assert.equal(database.prepare("SELECT customer_party_type FROM invoice_drafts WHERE id='draft-issued'").get()?.customer_party_type, "company")
      assert.equal(database.prepare("SELECT customer_party_type FROM issued_invoices WHERE id='invoice-1'").get()?.customer_party_type, "individual")
      assert.equal(database.prepare("SELECT customer_party_type FROM correction_documents WHERE id='correction-1'").get()?.customer_party_type, "individual")
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM draft_lines").get()?.count, 1)
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM invoice_payments").get()?.count, 1)
      assert.equal(database.prepare("SELECT last_number FROM invoice_sequences WHERE series='QWBE'").get()?.last_number, 7)
      const triggers = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map((row) => row.name))
      for (const name of ["invoice_drafts_no_issued_update", "invoice_drafts_no_issued_delete", "invoice_drafts_series_insert",
        "invoice_drafts_series_update", "issued_invoices_no_update", "issued_invoices_no_delete",
        "issued_lines_no_delete", "issued_tax_breakdown_no_delete"]) assert.equal(triggers.has(name), true)
      database.prepare("UPDATE issued_invoices SET e_factura_status='pending' WHERE id='invoice-1'").run()
      assert.throws(() => database.prepare("UPDATE issued_invoices SET issuer_county='IS' WHERE id='invoice-1'").run())
      assert.throws(() => database.prepare("UPDATE issued_invoices SET issuer_postal_code=NULL WHERE id='invoice-1'").run())
      assert.throws(() => database.prepare("DELETE FROM issued_invoices WHERE id='invoice-1'").run())
      assert.throws(() => database.prepare("DELETE FROM invoice_drafts WHERE id='draft-issued'").run())
      const next = database.prepare(`INSERT INTO invoice_sequences(organization_id,fiscal_year,document_type,series,last_number)
        VALUES('org-1',2026,'invoice','QWBE',1) ON CONFLICT(organization_id,fiscal_year,document_type,series)
        DO UPDATE SET last_number=last_number+1 RETURNING last_number`).get()?.last_number
      assert.equal(next, 8)
    } finally {
      database.close()
    }
    assert.equal(applyMigrations(directory).changed, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
