import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict, type ProformaConversion } from "../../cube/invoicing/index.ts"
import { withMigrated, type RawSql } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * Proforma lineage, read and enforced by the storage on PostgreSQL 16.
 *
 * Three things the port had to change. Fixtures are parameterised with `$N`.
 * There is no `PRAGMA foreign_keys=ON`: references are always enforced here,
 * which is stricter than the SQLite baseline was by default and is what the
 * negative cases below are actually asserting. And the direct conversion is
 * written inside one explicit transaction, because the lineage key is
 * `DEFERRABLE INITIALLY DEFERRED` and only fires at `COMMIT` — in autocommit the
 * invoice and its conversion row cannot be made visible to each other.
 */

const insertDraft = (sql: RawSql, id: string, organizationId = "org-1") => sql.query(`INSERT INTO invoice_drafts(
  id,organization_id,customer_party_type,customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,
  customer_street,customer_county,customer_vat_registered,series,issue_date,currency,status)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [
  id, organizationId, "company", "Client SRL", "87654329", "RO", "Iași", "Strada 1", "RO-IS", 1, "INV", "2026-09-01", "RON", "draft",
])

const insertProforma = (sql: RawSql, id: string, organizationId = "org-1", number = 1) => sql.query(`INSERT INTO proformas(
  id,source_draft_id,organization_id,fiscal_year,document_type,series,number,issue_date,issued_at,currency,
  issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,customer_party_type,
  customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_vat_registered,
  total_excluding_tax,tax_total,total_including_tax,sealed,issuer_legal_form,issuer_trade_registry_number,
  issuer_iban,issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered)
  VALUES($1,NULL,$2,2026,'proforma','PRO',$3,'2026-09-01','2026-09-01T10:00:00.000Z','RON',
  'Furnizor SRL','12345674','RO','Iași','Strada 2','RO-IS','company','Client SRL','87654329','RO','Iași','Strada 1','RO-IS',1,
  '0.00','0.00','0.00',1,'srl','J22/123/2020','','','1000.00','user-1',1)`, [id, organizationId, number])

const invoiceStatement = `INSERT INTO issued_invoices(
  id,draft_id,source_proforma_id,organization_id,fiscal_year,document_type,series,number,issue_date,issued_at,currency,
  issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,issuer_county,customer_party_type,
  customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,customer_county,customer_vat_registered,
  total_excluding_tax,tax_total,total_including_tax,issuer_legal_form,issuer_trade_registry_number,
  issuer_iban,issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered)
  VALUES($1,$2,$3,$4,2026,'invoice',$5,$6,'2026-09-01','2026-09-01T11:00:00.000Z','RON',
  'Furnizor SRL','12345674','RO','Iași','Strada 2','RO-IS','company','Client SRL','87654329','RO','Iași','Strada 1','RO-IS',1,
  '0.00','0.00','0.00','srl','J22/123/2020','','','1000.00','user-1',1)`

interface InvoiceFixture {
  readonly id: string
  readonly organizationId?: string
  readonly draftId: string | null
  readonly sourceProformaId: string | null
  readonly series?: string
  readonly number: number
}

const invoiceValues = (input: InvoiceFixture): ReadonlyArray<unknown> => [
  input.id, input.draftId, input.sourceProformaId, input.organizationId ?? "org-1", input.series ?? "INV", input.number,
]

const insertInvoice = (sql: RawSql, input: InvoiceFixture) => sql.query(invoiceStatement, invoiceValues(input))
const rejectInvoice = (sql: RawSql, input: InvoiceFixture) => sql.rejects(invoiceStatement, invoiceValues(input))

void test("projects authoritative proforma lineage and rejects forged or conflicting branches", async () => {
  await withMigrated("proforma_lineage", async ({ pool, sql }) => {
    await sql.exec(`INSERT INTO document_series VALUES
      ('org-1','invoice','INV'),('org-1','invoice','INV2'),('org-1','proforma','PRO'),
      ('org-2','invoice','INV'),('org-2','proforma','PRO')`)
    for (const id of ["normal", "derived", "direct-target", "draft-first"]) await insertDraft(sql, id)
    await insertDraft(sql, "other-draft", "org-2")
    for (const [index, id] of ["p-derived", "p-direct", "p-draft-first", "p-unlinked"].entries()) {
      await insertProforma(sql, id, "org-1", index + 1)
    }
    await insertProforma(sql, "p-other", "org-2")
    await sql.query("INSERT INTO proforma_conversions VALUES($1,$2,$3,$4,$5)",
      ["p-derived", "org-1", "derived", "user-1", "2026-09-01T10:30:00.000Z"])
    await sql.query("INSERT INTO proforma_conversions VALUES($1,$2,$3,$4,$5)",
      ["p-draft-first", "org-1", "draft-first", "user-1", "2026-09-01T10:31:00.000Z"])

    const store = createPostgresStore(pool)
    const projected = await Effect.runPromise(store.transaction((transaction) => Effect.gen(function*() {
      const normal = yield* transaction.findDraft("org-1", "normal")
      const derived = yield* transaction.findDraft("org-1", "derived")
      const otherScope = yield* transaction.findDraft("org-2", "derived")
      const listed = yield* transaction.listDrafts("org-1", { limit: 20 })
      return { normal, derived, otherScope, listed }
    })))
    assert.equal(projected.normal?.sourceProformaId, null)
    assert.equal(projected.derived?.sourceProformaId, "p-derived")
    assert.equal(projected.otherScope, undefined)
    assert.equal(projected.listed.find(({ id }) => id === "normal")?.sourceProformaId, null)
    assert.equal(projected.listed.find(({ id }) => id === "derived")?.sourceProformaId, "p-derived")

    assert.ok(projected.normal)
    const normal = projected.normal
    await Effect.runPromise(store.transaction((transaction) => transaction.saveDraft({
      ...normal, sourceProformaId: "p-other",
    })))
    assert.equal((await Effect.runPromise(store.transaction((transaction) => transaction.findDraft("org-1", "normal"))))?.sourceProformaId, null)
    const deletion = await Effect.runPromise(Effect.flip(store.transaction((transaction) => transaction.deleteDraft("org-1", "derived"))))
    assert.equal(deletion instanceof DomainConflict && deletion.code === "derived_draft_cannot_be_deleted", true)

    // A derived draft is referenced by its conversion row, so the reference
    // refuses the delete: `23503`, not a trigger.
    assert.equal((await sql.rejects("DELETE FROM invoice_drafts WHERE organization_id='org-1' AND id='derived'")).code, "23503")
    await insertInvoice(sql, { id: "ordinary-direct", draftId: null, sourceProformaId: null, number: 7 })
    await insertInvoice(sql, { id: "derived-invoice", draftId: "derived", sourceProformaId: "p-derived", series: "INV2", number: 1 })
    await insertInvoice(sql, { id: "normal-invoice", draftId: "normal", sourceProformaId: null, number: 1 })
    assert.equal((await rejectInvoice(sql, { id: "missing-origin", draftId: "draft-first", sourceProformaId: null, number: 2 })).code, "23514")
    // No conversion row names this proforma, and the lineage key is deferred, so
    // the refusal lands at the implicit commit of this statement.
    assert.equal((await rejectInvoice(sql, { id: "unlinked", draftId: null, sourceProformaId: "p-unlinked", number: 3 })).code, "23503")
    await sql.transaction(async (scoped) => {
      await insertInvoice(scoped, { id: "direct-invoice", draftId: null, sourceProformaId: "p-direct", number: 4 })
      await scoped.query(`INSERT INTO proforma_invoice_conversions(proforma_id,organization_id,resulting_invoice_id,actor_id,converted_at)
        VALUES($1,$2,$3,$4,$5)`, ["p-direct", "org-1", "direct-invoice", "user-1", "2026-09-01T12:00:00.000Z"])
    })
    assert.equal((await sql.rejects("INSERT INTO proforma_conversions VALUES($1,$2,$3,$4,$5)",
      ["p-direct", "org-1", "direct-target", "user-1", "2026-09-01T12:01:00.000Z"])).code, "23514")
    assert.equal((await rejectInvoice(sql, {
      id: "direct-after-draft", draftId: null, sourceProformaId: "p-draft-first", number: 5,
    })).code, "23514")
    // A proforma of another organization is refused by the lineage trigger before
    // the deferred key is ever consulted, so this one is `23514` and not `23503`.
    assert.equal((await rejectInvoice(sql, {
      id: "cross-tenant", organizationId: "org-1", draftId: null, sourceProformaId: "p-other", number: 6,
    })).code, "23514")
    assert.equal((await sql.rejects("UPDATE proforma_conversions SET actor_id='other' WHERE proforma_id='p-derived'")).code, "23514")
    assert.equal((await sql.rejects("UPDATE issued_invoices SET source_proforma_id=NULL WHERE id='derived-invoice'")).code, "23514")
    await sql.exec("UPDATE document_series SET series='RENAMED' WHERE organization_id='org-1' AND document_type='invoice' AND series='INV2'")
    assert.deepEqual(await sql.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema='public'
       AND table_name='proformas' AND column_name='invoice_series'`,
    ), [])

    const readModels = await Effect.runPromise(store.transaction((transaction) => Effect.all({
      derived: transaction.findProforma("org-1", "p-derived"),
      direct: transaction.findProforma("org-1", "p-direct"),
      normalInvoice: transaction.findIssuedInvoice("org-1", "normal-invoice"),
      ordinaryDirect: transaction.findIssuedInvoice("org-1", "ordinary-direct"),
      otherProformaScope: transaction.findProforma("org-1", "p-other"),
    })))
    assert.ok(readModels.derived)
    assert.ok(readModels.direct)
    assert.equal(readModels.derived.convertedDraftId, "derived")
    assert.equal(readModels.derived.convertedInvoiceId, "derived-invoice")
    assert.equal((await Effect.runPromise(store.transaction((transaction) => transaction.findIssuedInvoice("org-1", "derived-invoice"))))?.series, "INV2")
    assert.equal(Object.hasOwn(readModels.derived, "invoiceSeries"), false)
    assert.equal(readModels.direct.convertedDraftId, null)
    assert.equal(readModels.direct.convertedInvoiceId, "direct-invoice")
    assert.equal(readModels.normalInvoice?.sourceProformaId, null)
    assert.deepEqual([readModels.ordinaryDirect?.draftId, readModels.ordinaryDirect?.sourceProformaId], [null, null])
    assert.equal(readModels.otherProformaScope, undefined)
  })
})

void test("saveProformaConversion persists once inside the existing transaction", async () => {
  await withMigrated("proforma_conv", async ({ pool, sql }) => {
    await sql.exec("INSERT INTO document_series VALUES('org-1','invoice','INV'),('org-1','proforma','PRO')")
    await insertDraft(sql, "derived")
    await insertProforma(sql, "proforma")
    const conversion: ProformaConversion = { proformaId: "proforma", organizationId: "org-1", resultingDraftId: "derived",
      actorId: "user-1", convertedAt: "2026-09-01T12:00:00.000Z" }
    const store = createPostgresStore(pool)
    await Effect.runPromise(store.transaction((transaction) => transaction.saveProformaConversion(conversion)))
    assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProformaConversion("org-1", "proforma"))), conversion)
    const duplicate = await Effect.runPromise(Effect.flip(store.transaction((transaction) => transaction.saveProformaConversion(conversion))))
    assert.equal(duplicate instanceof DomainConflict && duplicate.code === "proforma_already_converted", true)
  })
})
