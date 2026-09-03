import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { invoicingMigrations } from "../cube/invoicing/index.ts"
import { documentsMigrations } from "../cube/invoicing/documents/index.ts"
import { applyMigrations, databasePath, documentsDatabasePath } from "./migrations.ts"

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
       INSERT INTO correction_lines VALUES('line-correction','correction-1',0,'Servicii','1.0000','-100.00','RO_STANDARD','standard','21.00','-100.00','-21.00','-121.00');
       INSERT INTO correction_tax_breakdown VALUES('correction-1',0,'RO_STANDARD','standard','21.00','-100.00','-21.00');
    `)
  } finally {
    database.close()
  }
}

void test("upgrades a populated version-six database without rewriting migration history", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-upgrade-"))
  try {
    seedVersionSix(directory)
    assert.equal(applyMigrations(directory).changed, 7)
    const database = new DatabaseSync(databasePath(directory))
    try {
      database.exec("PRAGMA foreign_keys = ON")
      assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [])
      const migrations = database.prepare("SELECT name FROM schema_migrations ORDER BY name").all()
        .map((row) => row.name)
      assert.deepEqual(migrations, ["000-foundation", "001-invoice-core", "002-invoice-payments", "003-invoice-corrections",
        "004-invoice-delete-last", "005-allow-e-factura-status-update", "006-customer-soft-delete", "007-complete-invoice-authoring",
         "008-proforma-workflow", "009-proforma-direct-invoice"])
      const columns = database.prepare("PRAGMA table_info(invoice_drafts)").all()
      assert.equal(columns.some((row) => row.name === "customer_id" && row.notnull === 0), true)
      assert.equal(columns.some((row) => row.name === "due_date" && row.notnull === 0), true)
      assert.equal(database.prepare("PRAGMA table_info(issued_invoices)").all()
        .some((row) => row.name === "due_date" && row.notnull === 0), true)
      assert.equal(database.prepare("PRAGMA table_info(issued_invoices)").all()
        .some((row) => row.name === "draft_id" && row.notnull === 0), true)
      assert.equal(database.prepare("PRAGMA table_info(proformas)").all()
        .some((row) => row.name === "source_draft_id" && row.notnull === 0), true)
      assert.ok(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='proforma_invoice_conversions'").get())
      assert.equal(database.prepare("PRAGMA foreign_key_list(invoice_drafts)").all().some((row) => row.table === "customers"), true)
      assert.equal(database.prepare("PRAGMA foreign_key_list(draft_lines)").all().some((row) => row.table === "invoice_drafts"), true)
      assert.equal(database.prepare("SELECT customer_party_type FROM invoice_drafts WHERE id='draft-open'").get()?.customer_party_type, "individual")
      assert.equal(database.prepare("SELECT customer_party_type FROM invoice_drafts WHERE id='draft-issued'").get()?.customer_party_type, "company")
      assert.equal(database.prepare("SELECT customer_party_type FROM issued_invoices WHERE id='invoice-1'").get()?.customer_party_type, "individual")
      assert.equal(database.prepare("SELECT customer_party_type FROM correction_documents WHERE id='correction-1'").get()?.customer_party_type, "individual")
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM draft_lines").get()?.count, 1)
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM invoice_payments").get()?.count, 1)
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correction_lines").get()?.count, 1)
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM correction_tax_breakdown").get()?.count, 1)
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
      database.prepare(`INSERT INTO invoice_drafts(id,organization_id,customer_id,customer_party_type,customer_legal_name,
        customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_postal_code,
        series,issue_date,due_date,currency,status) VALUES('draft-null','org-1',NULL,'individual','Ana','','RO','Iași','Strada 4',NULL,NULL,
        'QWBE','2026-09-04',NULL,'RON','issued')`).run()
      database.prepare(`INSERT INTO issued_invoices SELECT 'invoice-null','draft-null',organization_id,fiscal_year,document_type,
        series,8,'2026-09-04',NULL,issued_at,currency,issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,
        issuer_street,issuer_county,issuer_postal_code,customer_legal_name,customer_tax_identifier,customer_country_code,
        customer_city,customer_street,customer_county,customer_postal_code,total_excluding_tax,tax_total,total_including_tax,
        e_factura_status,customer_party_type,NULL FROM issued_invoices WHERE id='invoice-1'`).run()
      assert.equal(database.prepare("SELECT due_date FROM issued_invoices WHERE id='invoice-null'").get()?.due_date, null)
    } finally {
      database.close()
    }
    assert.equal(applyMigrations(directory).changed, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("009 preserves legacy proforma-to-draft conversion audit", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-proforma-upgrade-"))
  try {
    const database = new DatabaseSync(databasePath(directory))
    try {
      database.exec("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)STRICT")
      for (const migration of invoicingMigrations.filter(({ name }) => name <= "008-proforma-workflow")) {
        if ("foreignKeys" in migration) database.exec("PRAGMA foreign_keys=OFF")
        database.exec("BEGIN")
        for (const statement of migration.statements) database.exec(statement)
        database.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(migration.name, "2026-01-01")
        database.exec("COMMIT")
      }
      database.exec(`
        INSERT INTO document_series VALUES('org-1','invoice','INV'),('org-1','proforma','PRO');
        INSERT INTO invoice_drafts VALUES
          ('source','org-1',NULL,'company','Client SRL','RO87654329','RO','Iași','Strada 1',NULL,NULL,'INV','2026-09-01',NULL,'RON','proforma_issued'),
          ('legacy-result','org-1',NULL,'company','Client SRL','RO87654329','RO','Iași','Strada 1',NULL,NULL,'INV','2026-09-01',NULL,'RON','draft');
        INSERT INTO proformas VALUES('proforma-1','source','org-1',2026,'proforma','PRO',1,'2026-09-01',NULL,
          '2026-09-01T10:00:00.000Z','RON','Furnizor SRL','RO12345674','RO','Iași','Strada 2',NULL,NULL,
          'company','Client SRL','RO87654329','RO','Iași','Strada 1',NULL,NULL,'100.00','21.00','121.00',1);
        INSERT INTO proforma_conversions VALUES('proforma-1','org-1','legacy-result','user-1','2026-09-02T10:00:00.000Z');
      `)
    } finally { database.close() }
    assert.ok(applyMigrations(directory).changed > 0)
    const upgraded = new DatabaseSync(databasePath(directory), { readOnly: true })
    try {
      assert.deepEqual({ ...upgraded.prepare("SELECT * FROM proforma_conversions").get() }, {
        proforma_id: "proforma-1", organization_id: "org-1", resulting_draft_id: "legacy-result",
        actor_id: "user-1", converted_at: "2026-09-02T10:00:00.000Z",
      })
      assert.deepEqual({ ...upgraded.prepare("SELECT source_draft_id,invoice_series FROM proformas").get() },
        { source_draft_id: "source", invoice_series: "INV" })
    } finally { upgraded.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

void test("adds proforma artifacts without changing existing invoice artifact metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-documents-upgrade-"))
  try {
    const database = new DatabaseSync(documentsDatabasePath(directory))
    try {
      database.exec("CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,applied_at TEXT NOT NULL)STRICT")
      const invoiceMigration = documentsMigrations[0]
      assert.ok(invoiceMigration)
      for (const statement of invoiceMigration.statements) database.exec(statement)
      database.prepare("INSERT INTO schema_migrations VALUES(?,?)").run(invoiceMigration.name, "2026-01-01")
      database.prepare(`INSERT INTO invoice_artifacts
        (invoice_id,organization_id,object_key,sha256,byte_length,media_type,template_version,generated_at)
        VALUES(?,?,?,?,?,?,?,?)`).run(
        "invoice-1", "org-1", `sha256/${"a".repeat(2)}/${"a".repeat(64)}.pdf`, "a".repeat(64), 123,
        "application/pdf", "invoice-v1", "2026-01-01T00:00:00.000Z",
      )
    } finally {
      database.close()
    }
    applyMigrations(directory)
    const upgraded = new DatabaseSync(documentsDatabasePath(directory), { readOnly: true })
    try {
      assert.deepEqual({ ...upgraded.prepare("SELECT * FROM invoice_artifacts").get() }, {
        invoice_id: "invoice-1", organization_id: "org-1",
        object_key: `sha256/${"a".repeat(2)}/${"a".repeat(64)}.pdf`, sha256: "a".repeat(64), byte_length: 123,
        media_type: "application/pdf", template_version: "invoice-v1", generated_at: "2026-01-01T00:00:00.000Z",
      })
      assert.ok(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='proforma_artifacts'").get())
    } finally {
      upgraded.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
