import assert from "node:assert/strict"
import test from "node:test"

import { ROMANIAN_COUNTIES } from "../../cube/invoicing/index.ts"
import { migrationScopes } from "./postgres-migration-plans.ts"
import { withEmpty, withMigrated, type RawSql } from "./postgres-rig.test-support.ts"

/**
 * The schema each baseline leaves behind, read out of the PostgreSQL catalogue.
 *
 * Two premises could not survive the move and were replaced, not dropped:
 *
 * - A cube baseline can no longer be applied on its own in an empty
 *   `:memory:` database, because one database now holds every scope and the
 *   cross-cube foreign keys are real. Ownership is therefore measured as a
 *   delta: the scopes are applied in application order and each scope must add
 *   exactly the tables its manifest claims.
 * - `pragma_foreign_key_list` against a missing parent has no counterpart,
 *   because PostgreSQL will not even accept the declaration: a reference to an
 *   absent table is `42P01` at `CREATE TABLE` time. That is asserted directly,
 *   where SQLite needed a catalogue query to find it afterwards.
 */

const tablesOf = async (sql: RawSql): Promise<ReadonlyArray<string>> =>
  (await sql.query<{ readonly tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  )).map(({ tablename }) => tablename)

/** The tables a set of statements adds, which is the ownership claim under test. */
const tablesAddedBy = async (sql: RawSql, statements: ReadonlyArray<string>): Promise<ReadonlyArray<string>> => {
  const before = new Set(await tablesOf(sql))
  for (const statement of statements) await sql.exec(statement)
  return (await tablesOf(sql)).filter((table) => !before.has(table))
}

// The delta has to be able to fail: a statement that creates a table nobody
// claims must show up in it, or the ownership checks below prove nothing.
void test("the ownership delta names a table its scope does not declare", async () => {
  await withEmpty("baseline_owner", async ({ sql }) => {
    const declared: ReadonlyArray<string> = []
    const added = await tablesAddedBy(sql, ["CREATE TABLE intruder(id TEXT PRIMARY KEY)"])
    assert.deepEqual(added, ["intruder"])
    assert.notDeepEqual(added, declared)
    assert.deepEqual(await tablesAddedBy(sql, []), [])
  })
})

// A scope owns exactly the tables its manifest declares, and its own baseline is
// what creates them: no table goes unowned or gets created by another scope.
void test("each cube baseline creates exactly the tables its manifest declares", async () => {
  await withEmpty("baseline_scopes", async ({ sql }) => {
    for (const { scope, migrations, tables } of migrationScopes) {
      const added = await tablesAddedBy(sql, migrations.flatMap(({ statements }) => statements))
      assert.deepEqual([...added].sort(), [...tables].sort(), scope)
    }
    assert.deepEqual(await tablesOf(sql), [...migrationScopes.flatMap(({ tables }) => tables)].sort())
  })
})

void test("the composed baselines satisfy every foreign key", async () => {
  await withMigrated("baseline_keys", async ({ sql }) => {
    // Every declared key is validated and points at a table that exists; an
    // unvalidated or orphaned key would be reported here by name.
    assert.deepEqual(await sql.query(
      `SELECT conname, conrelid::regclass::text AS child FROM pg_constraint
       WHERE contype = 'f' AND connamespace = 'public'::regnamespace
         AND (NOT convalidated OR confrelid = 0 OR to_regclass(confrelid::regclass::text) IS NULL)
       ORDER BY conname`,
    ), [])
    assert.ok(Number(await sql.scalar(
      `SELECT count(*) FROM pg_constraint WHERE contype = 'f' AND connamespace = 'public'::regnamespace`,
    )) > 20)
    // The declaration itself is refused, so a dangling parent cannot be stored
    // in the first place.
    const dangling = await sql.rejects("CREATE TABLE child(parent_id TEXT REFERENCES absent_parent(id))")
    assert.equal(dangling.code, "42P01")
  })
})

void test("stores party addresses and buyer VAT status in strict columns, with due dates optional", async () => {
  await withMigrated("baseline_party", async ({ sql }) => {
    const requiredColumns = {
      issuers: ["county", "sector"],
      customers: ["county", "sector", "vat_registered"],
      invoice_drafts: ["customer_county", "customer_sector", "customer_vat_registered"],
      issued_invoices: ["issuer_county", "issuer_sector", "customer_county", "customer_sector", "customer_vat_registered"],
      proformas: ["issuer_county", "issuer_sector", "customer_county", "customer_sector", "customer_vat_registered"],
      correction_documents: ["issuer_county", "issuer_sector", "customer_county", "customer_sector", "customer_vat_registered"],
    } as const
    const nullability = async (table: string) => new Map((await sql.query<{ readonly column_name: string; readonly is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`, [table],
    )).map(({ column_name, is_nullable }) => [column_name, is_nullable]))
    for (const [table, names] of Object.entries(requiredColumns)) {
      const columns = await nullability(table)
      for (const name of names) {
        assert.equal(columns.get(name), name.endsWith("sector") ? "YES" : "NO", `${table}.${name}`)
      }
      // The county list lives in the named CHECK, read back from the catalogue.
      const definitions = (await sql.query<{ readonly definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
         WHERE contype = 'c' AND conrelid = $1::regclass`, [table],
      )).map(({ definition }) => definition).join(" ")
      assert.deepEqual(new Set(definitions.match(/RO-(?:[A-Z]{2}|B)(?=')/gu) ?? []),
        new Set(ROMANIAN_COUNTIES.map(({ code }) => code)), `${table} county CHECK`)
    }
    for (const table of ["invoice_drafts", "issued_invoices", "proformas"]) {
      assert.equal((await nullability(table)).get("due_date"), "YES", `${table}.due_date`)
    }
    await sql.exec(`
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
    for (const [statement, constraint] of [
      [`INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,party_type,vat_registered)
        VALUES('bad-county','org-1','Bad','1','RO','X','X','IS','company',0)`, "customers_county_valid"],
      [`INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,party_type,vat_registered)
        VALUES('missing-sector','org-1','Bad','1','RO','X','X','RO-B',NULL,'company',0)`, "customers_bucharest_sector"],
      [`INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,sector,party_type,vat_registered)
        VALUES('extra-sector','org-1','Bad','1','RO','X','X','RO-IS',1,'company',0)`, "customers_bucharest_sector"],
      [`INSERT INTO customers(id,organization_id,legal_name,tax_identifier,country_code,city,street,county,party_type,vat_registered)
        VALUES('individual-vat','org-1','Ion','','RO','Iași','X','RO-IS','individual',1)`, "customers_vat_registered_valid"],
    ] as const) {
      const failure = await sql.rejects(statement)
      assert.equal(failure.code, "23514", constraint)
      assert.equal(failure.constraint, constraint)
    }
  })
})

void test("keeps document notes optional and bounded, and guarded by the immutability triggers", async () => {
  await withMigrated("baseline_notes", async ({ sql }) => {
    for (const table of ["invoice_drafts", "proformas", "issued_invoices"]) {
      assert.deepEqual(await sql.one(
        `SELECT data_type, is_nullable FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'notes'`, [table],
      ), { data_type: "text", is_nullable: "YES" }, table)
    }
    // `UPDATE OF notes` is part of the trigger definition, so the catalogue
    // carries the guarantee the SQLite trigger body used to spell out.
    const triggers = await sql.query<{ readonly tgname: string; readonly definition: string }>(
      `SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger
       WHERE tgname IN ('issued_invoices_no_update','proformas_no_content_update') ORDER BY tgname`,
    )
    assert.deepEqual(triggers.map(({ tgname }) => tgname), ["issued_invoices_no_update", "proformas_no_content_update"])
    for (const trigger of triggers) assert.match(trigger.definition, /\bnotes\b/u, trigger.tgname)
    await sql.exec(`
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
    assert.equal(await sql.scalar("SELECT notes FROM invoice_drafts WHERE id = 'draft-1'"), "Observație")
    assert.equal(await sql.rowCount("UPDATE invoice_drafts SET notes = NULL WHERE id = 'draft-1'"), 1)
    assert.equal(await sql.scalar("SELECT notes FROM invoice_drafts WHERE id = 'draft-1'"), null)
    for (const value of [" spatii ", "", "x".repeat(501)]) {
      const failure = await sql.rejects("UPDATE invoice_drafts SET notes = $1 WHERE id = 'draft-1'", [value])
      assert.equal(failure.code, "23514", value)
      assert.equal(failure.constraint, "invoice_drafts_notes_shape", value)
    }
  })
})

// Rules the storage enforces on its own, whatever the application sends: a
// negative payment term, a price with more than two decimals, and an issued
// invoice whose only mutable fact is its e-Factura status.
void test("refuses negative payment terms and over-precise preset prices, and lets an issued invoice change only its e-Factura status", async () => {
  await withMigrated("baseline_rules", async ({ sql }) => {
    await sql.exec(`
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
    const negativeTerm = await sql.rejects("UPDATE customers SET default_payment_term_days=-1 WHERE id='customer-1'")
    assert.equal(negativeTerm.code, "23514")
    assert.equal(negativeTerm.constraint, "customers_payment_term_non_negative")
    assert.equal(await sql.scalar("SELECT default_payment_term_days FROM customers WHERE id='customer-1'"), 30)
    for (const price of ["1.001", "1.0", "1", "-1.00", "1.00.00"]) {
      const failure = await sql.rejects(`INSERT INTO product_presets(id,organization_id,description,unit_price,unit_code,unit_name)
        VALUES('bad','org-1','Bad',$1,'C62','unitate')`, [price])
      assert.equal(failure.code, "23514", price)
      assert.equal(failure.constraint, "product_presets_unit_price_shape", price)
    }
    assert.equal(Number(await sql.scalar("SELECT count(*) FROM product_presets")), 1)

    assert.equal(await sql.rowCount("UPDATE issued_invoices SET e_factura_status='pending' WHERE id='invoice-1'"), 1)
    assert.equal(await sql.scalar("SELECT e_factura_status FROM issued_invoices WHERE id='invoice-1'"), "pending")
    for (const change of ["issuer_county='RO-CJ'", "customer_legal_name='Alt client'", "total_including_tax='1.00'", "notes='Adaugata'"]) {
      const failure = await sql.rejects(`UPDATE issued_invoices SET ${change} WHERE id='invoice-1'`)
      assert.equal(failure.code, "23514", change)
      assert.match(failure.message, /issued invoices are immutable except e_factura_status/u, change)
    }
    for (const [statement, message] of [
      ["UPDATE issued_invoices SET source_app='crm' WHERE id='invoice-1'", /issued invoice source is immutable/u],
      ["UPDATE issued_invoices SET actor_id='other' WHERE id='invoice-1'", /issued invoice actor is immutable/u],
      ["DELETE FROM issued_invoices WHERE id='invoice-1'", /issued invoices are immutable/u],
      ["DELETE FROM invoice_drafts WHERE id='draft-1'", /issued drafts are immutable/u],
    ] as const) {
      const failure = await sql.rejects(statement)
      assert.equal(failure.code, "23514", statement)
      assert.match(failure.message, message, statement)
    }
    assert.deepEqual(await sql.one(`SELECT issuer_county,customer_legal_name,total_including_tax,notes,e_factura_status
      FROM issued_invoices WHERE id='invoice-1'`),
      { issuer_county: "RO-IS", customer_legal_name: "Client SRL", total_including_tax: "121.00", notes: null, e_factura_status: "pending" })
  })
})
