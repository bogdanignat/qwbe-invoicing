import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { ROMANIAN_COUNTIES, cube as invoicingCube, invoicingMigrations } from "../cube/invoicing/index.ts"
import { cube as customersCube, customersMigrations } from "../cube/invoicing/customers/index.ts"
import { cube as documentsCube, documentsMigrations } from "../cube/invoicing/documents/index.ts"
import { cube as paymentsCube, paymentsMigrations } from "../cube/payments/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"

// The schema each cube baseline leaves behind: the checks here read the stored
// columns and constraints directly, so they hold whatever the application does.

const createdTables = (migrations: ReadonlyArray<{ readonly statements: ReadonlyArray<string> }>): ReadonlyArray<string> => {
  const database = new DatabaseSync(":memory:")
  try {
    for (const migration of migrations) for (const statement of migration.statements) database.exec(statement)
    return database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((row) => String(row.name))
  } finally {
    database.close()
  }
}

// A cube owns exactly the tables its manifest declares, and its own baseline is
// what creates them: no table goes unowned or gets created by another cube.
void test("each cube baseline creates exactly the tables its manifest declares", () => {
  for (const [cube, migrations] of [
    [invoicingCube, invoicingMigrations],
    [customersCube, customersMigrations],
    [paymentsCube, paymentsMigrations],
    [documentsCube, documentsMigrations],
  ] as const) {
    assert.deepEqual(createdTables(migrations), [...cube.manifest.tables].sort(), cube.manifest.name)
  }
})

void test("stores party addresses and buyer VAT status in strict columns, with due dates optional", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-party-schema-"))
  try {
    applyMigrations(directory)
    const database = new DatabaseSync(databasePath(directory))
    try {
      const requiredColumns = {
        issuers: ["county", "sector"],
        customers: ["county", "sector", "vat_registered"],
        invoice_drafts: ["customer_county", "customer_sector", "customer_vat_registered"],
        issued_invoices: ["issuer_county", "issuer_sector", "customer_county", "customer_sector", "customer_vat_registered"],
        proformas: ["issuer_county", "issuer_sector", "customer_county", "customer_sector", "customer_vat_registered"],
        correction_documents: ["issuer_county", "issuer_sector", "customer_county", "customer_sector", "customer_vat_registered"],
      } as const
      for (const [table, names] of Object.entries(requiredColumns)) {
        const columns = new Map(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => [column.name, column]))
        for (const name of names) assert.equal(columns.get(name)?.notnull, name.endsWith("sector") ? 0 : 1, `${table}.${name}`)
        const sql = String(database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql)
        const storedCountyCodes = new Set(sql.match(/RO-(?:[A-Z]{2}|B)(?=')/g) ?? [])
        assert.deepEqual(storedCountyCodes, new Set(ROMANIAN_COUNTIES.map(({ code }) => code)), `${table} county CHECK`)
      }
      for (const table of ["invoice_drafts", "issued_invoices", "proformas"]) {
        assert.equal(database.prepare(`PRAGMA table_info(${table})`).all()
          .find((column) => column.name === "due_date")?.notnull, 0, `${table}.due_date`)
      }
      database.exec(`
        INSERT INTO issuers(organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,postal_code,
          default_currency,default_payment_term_days,legal_form,trade_registry_number,iban,bank_name,social_capital)
          VALUES('org-1','Furnizor SRL','12345674','RO','București','Strada 1','RO-B',1,NULL,'RON',15,'srl','J40/1/2020','','','200.00');
        INSERT INTO document_series VALUES('org-1','invoice','INV');
        INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,postal_code,party_type,vat_registered)
          VALUES('customer-1','org-1','Client SRL','87654329','RO','Iași','Strada 2','RO-IS',NULL,NULL,'company',1);
        INSERT INTO invoice_drafts(id,organization_id,customer_id,customer_party_type,customer_legal_name,customer_tax_identifier,
          customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,customer_vat_registered,
          series,issue_date,due_date,currency,status)
          VALUES('draft-1','org-1','customer-1','company','Client SRL','87654329','RO','Iași','Strada 2','RO-IS',NULL,NULL,1,
          'INV','2026-09-01',NULL,'RON','draft');
      `)
      assert.throws(() => database.prepare("INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,party_type,vat_registered) VALUES('bad-county','org-1','Bad','1','RO','X','X','IS','company',0)").run())
      assert.throws(() => database.prepare("INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,party_type,vat_registered) VALUES('missing-sector','org-1','Bad','1','RO','X','X','RO-B',NULL,'company',0)").run())
      assert.throws(() => database.prepare("INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,party_type,vat_registered) VALUES('extra-sector','org-1','Bad','1','RO','X','X','RO-IS',1,'company',0)").run())
      assert.throws(() => database.prepare("INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,party_type,vat_registered) VALUES('individual-vat','org-1','Ion','','RO','Iași','X','RO-IS','individual',1)").run())
    } finally { database.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

void test("keeps document notes optional and bounded, and guarded by the immutability triggers", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-notes-schema-"))
  try {
    applyMigrations(directory)
    const database = new DatabaseSync(databasePath(directory))
    try {
      for (const table of ["invoice_drafts", "proformas", "issued_invoices"]) {
        const column = database.prepare(`SELECT * FROM pragma_table_info(?) WHERE name = 'notes'`).get(table) as
          { readonly type: string; readonly notnull: number } | undefined
        assert.deepEqual(column === undefined ? undefined : { type: column.type, notnull: column.notnull }, { type: "TEXT", notnull: 0 }, table)
      }
      const triggers = database.prepare("SELECT name,sql FROM sqlite_master WHERE type = 'trigger' AND name IN ('issued_invoices_no_update','proformas_no_content_update')").all()
      assert.equal(triggers.length, 2)
      for (const trigger of triggers) assert.ok(String(trigger.sql).includes("notes"), String(trigger.name))
      database.exec(`
        INSERT INTO issuers(organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,postal_code,default_currency,default_payment_term_days,
          legal_form,trade_registry_number,iban,bank_name,social_capital)
          VALUES('org-1','Furnizor SRL','12345674','RO','Iași','Strada 1','RO-IS',NULL,NULL,'RON',15,'srl','J22/123/2020','','','1000.00');
        INSERT INTO document_series VALUES('org-1','invoice','INV'),('org-1','proforma','PRO');
        INSERT INTO invoice_drafts(id,organization_id,customer_id,customer_party_type,customer_legal_name,customer_tax_identifier,
          customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,customer_vat_registered,
          series,issue_date,due_date,currency,status,notes)
          VALUES('draft-1','org-1',NULL,'company','Client SRL','87654329','RO','Iași','Strada 1','RO-IS',NULL,NULL,1,
          'INV','2026-09-01',NULL,'RON','draft','Observație');
      `)
      assert.equal(database.prepare("SELECT notes FROM invoice_drafts WHERE id = 'draft-1'").get()?.notes, "Observație")
      database.prepare("UPDATE invoice_drafts SET notes = NULL WHERE id = 'draft-1'").run()
      assert.equal(database.prepare("SELECT notes FROM invoice_drafts WHERE id = 'draft-1'").get()?.notes, null)
      assert.throws(() => database.prepare("UPDATE invoice_drafts SET notes = ' spatii ' WHERE id = 'draft-1'").run())
      assert.throws(() => database.prepare("UPDATE invoice_drafts SET notes = '' WHERE id = 'draft-1'").run())
      assert.throws(() => database.prepare(`UPDATE invoice_drafts SET notes = ? WHERE id = 'draft-1'`).run("x".repeat(501)))
    } finally { database.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

// Rules the storage enforces on its own, whatever the application sends: a
// negative payment term, a price with more than two decimals, and an issued
// invoice whose only mutable fact is its e-Factura status.
void test("refuses negative payment terms and over-precise preset prices, and lets an issued invoice change only its e-Factura status", () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-storage-rules-"))
  try {
    applyMigrations(directory)
    const database = new DatabaseSync(databasePath(directory))
    try {
      database.exec("PRAGMA foreign_keys=ON")
      database.exec(`
        INSERT INTO issuers(organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,postal_code,default_currency,default_payment_term_days,
          legal_form,trade_registry_number,iban,bank_name,social_capital)
          VALUES('org-1','Furnizor SRL','12345674','RO','Iași','Strada 1','RO-IS',NULL,NULL,'RON',15,'srl','J22/123/2020','','','1000.00');
        INSERT INTO document_series VALUES('org-1','invoice','INV');
        INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,postal_code,party_type,vat_registered,default_payment_term_days)
          VALUES('customer-1','org-1','Client SRL','87654329','RO','Iași','Strada 2','RO-IS',NULL,NULL,'company',1,30);
        INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name)
          VALUES('preset-1','org-1','Servicii','100.00','C62','unitate');
        INSERT INTO invoice_drafts(id,organization_id,customer_id,customer_party_type,customer_legal_name,customer_tax_identifier,
          customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,customer_vat_registered,
          series,issue_date,due_date,currency,status)
          VALUES('draft-1','org-1','customer-1','company','Client SRL','87654329','RO','Iași','Strada 2','RO-IS',NULL,NULL,1,
          'INV','2026-09-01',NULL,'RON','issued');
        INSERT INTO issued_invoices(id,draft_id,organization_id,fiscal_year,document_type,series,number,issue_date,due_date,issued_at,currency,
          issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,issuer_sector,issuer_postal_code,
          customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_sector,customer_postal_code,
          total_excluding_tax,tax_total,total_including_tax,customer_party_type,customer_vat_registered,
          issuer_legal_form,issuer_trade_registry_number,issuer_iban,issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered)
          VALUES('invoice-1','draft-1','org-1',2026,'invoice','INV',1,'2026-09-01',NULL,'2026-09-01T10:00:00.000Z','RON',
          'Furnizor SRL','12345674','RO','Iași','Strada 1','RO-IS',NULL,NULL,
          'Client SRL','87654329','RO','Iași','Strada 2','RO-IS',NULL,NULL,
          '100.00','21.00','121.00','company',1,'srl','J22/123/2020','','','1000.00','operator',1);
      `)
      assert.throws(() => database.prepare("UPDATE customers SET default_payment_term_days=-1 WHERE id='customer-1'").run(),
        /CHECK constraint failed: default_payment_term_days>=0/)
      assert.equal(database.prepare("SELECT default_payment_term_days FROM customers WHERE id='customer-1'").get()?.default_payment_term_days, 30)
      for (const price of ["1.001", "1.0", "1", "-1.00", "1.00.00"]) {
        assert.throws(() => database.prepare(`INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name)
          VALUES('bad','org-1','Bad',?,'C62','unitate')`).run(price), /CHECK constraint failed: unit_price/, price)
      }
      assert.equal(database.prepare("SELECT COUNT(*) AS count FROM product_presets").get()?.count, 1)

      database.prepare("UPDATE issued_invoices SET e_factura_status='pending' WHERE id='invoice-1'").run()
      assert.equal(database.prepare("SELECT e_factura_status FROM issued_invoices WHERE id='invoice-1'").get()?.e_factura_status, "pending")
      for (const change of ["issuer_county='RO-CJ'", "customer_legal_name='Alt client'", "total_including_tax='1.00'", "notes='Adaugata'"]) {
        assert.throws(() => database.prepare(`UPDATE issued_invoices SET ${change} WHERE id='invoice-1'`).run(),
          /issued invoices are immutable except e_factura_status/, change)
      }
      assert.throws(() => database.prepare("UPDATE issued_invoices SET source_app='crm' WHERE id='invoice-1'").run(), /issued invoice source is immutable/)
      assert.throws(() => database.prepare("UPDATE issued_invoices SET actor_id='other' WHERE id='invoice-1'").run(), /issued invoice actor is immutable/)
      assert.throws(() => database.prepare("DELETE FROM issued_invoices WHERE id='invoice-1'").run(), /issued invoices are immutable/)
      assert.throws(() => database.prepare("DELETE FROM invoice_drafts WHERE id='draft-1'").run(), /issued drafts are immutable/)
      assert.deepEqual({ ...database.prepare(`SELECT issuer_county,customer_legal_name,total_including_tax,notes,e_factura_status
        FROM issued_invoices WHERE id='invoice-1'`).get() },
        { issuer_county: "RO-IS", customer_legal_name: "Client SRL", total_including_tax: "121.00", notes: null, e_factura_status: "pending" })
    } finally { database.close() }
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
