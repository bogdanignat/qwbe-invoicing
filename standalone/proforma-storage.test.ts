import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict, type ProformaConversion } from "../cube/invoicing/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

const insertDraft = (database: DatabaseSync, id: string, organizationId = "org-1") => database.prepare(`INSERT INTO invoice_drafts(
  id,organization_id,customer_party_type,customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,
  customer_street,series,issue_date,currency,status)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(
  id, organizationId, "company", "Client SRL", "RO87654329", "RO", "Iași", "Strada 1", "INV", "2026-09-01", "RON", "draft",
)

const insertProforma = (database: DatabaseSync, id: string, organizationId = "org-1", number = 1) => database.prepare(`INSERT INTO proformas(
  id,source_draft_id,organization_id,fiscal_year,document_type,series,number,issue_date,issued_at,currency,
  issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,customer_party_type,
  customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,
  total_excluding_tax,tax_total,total_including_tax,sealed,issuer_legal_form,issuer_trade_registry_number,
  issuer_iban,issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered)
  VALUES(?,NULL,?,2026,'proforma','PRO',?,'2026-09-01','2026-09-01T10:00:00.000Z','RON',
  'Furnizor SRL','RO12345674','RO','Iași','Strada 2','company','Client SRL','RO87654329','RO','Iași','Strada 1',
  '0.00','0.00','0.00',1,'srl','J22/123/2020','','','1000.00','user-1',1)`).run(id, organizationId, number)

const insertInvoice = (database: DatabaseSync, input: {
  readonly id: string
  readonly organizationId?: string
  readonly draftId: string | null
  readonly sourceProformaId: string | null
  readonly series?: string
  readonly number: number
}) => database.prepare(`INSERT INTO issued_invoices(
  id,draft_id,source_proforma_id,organization_id,fiscal_year,document_type,series,number,issue_date,issued_at,currency,
  issuer_legal_name,issuer_tax_identifier,issuer_country_code,issuer_city,issuer_street,customer_party_type,
  customer_legal_name,customer_tax_identifier,customer_country_code,customer_city,customer_street,
  total_excluding_tax,tax_total,total_including_tax,issuer_legal_form,issuer_trade_registry_number,
  issuer_iban,issuer_bank_name,issuer_social_capital,actor_id,issuer_vat_registered)
  VALUES(?,?,?,?,2026,'invoice',?,?,'2026-09-01','2026-09-01T11:00:00.000Z','RON',
  'Furnizor SRL','RO12345674','RO','Iași','Strada 2','company','Client SRL','RO87654329','RO','Iași','Strada 1',
  '0.00','0.00','0.00','srl','J22/123/2020','','','1000.00','user-1',1)`).run(
  input.id, input.draftId, input.sourceProformaId, input.organizationId ?? "org-1", input.series ?? "INV", input.number,
)

void test("projects authoritative proforma lineage and rejects forged or conflicting branches", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-proforma-storage-"))
  try {
    applyMigrations(directory)
    const database = new DatabaseSync(databasePath(directory))
    try {
      database.exec("PRAGMA foreign_keys=ON")
      database.exec(`INSERT INTO document_series VALUES
        ('org-1','invoice','INV'),('org-1','invoice','INV2'),('org-1','proforma','PRO'),
        ('org-2','invoice','INV'),('org-2','proforma','PRO')`)
      for (const id of ["normal", "derived", "direct-target", "draft-first"]) insertDraft(database, id)
      insertDraft(database, "other-draft", "org-2")
      for (const [index, id] of ["p-derived", "p-direct", "p-draft-first", "p-unlinked"].entries()) {
        insertProforma(database, id, "org-1", index + 1)
      }
      insertProforma(database, "p-other", "org-2")
      database.prepare("INSERT INTO proforma_conversions VALUES(?,?,?,?,?)").run(
        "p-derived", "org-1", "derived", "user-1", "2026-09-01T10:30:00.000Z",
      )
      database.prepare("INSERT INTO proforma_conversions VALUES(?,?,?,?,?)").run(
        "p-draft-first", "org-1", "draft-first", "user-1", "2026-09-01T10:31:00.000Z",
      )
    } finally { database.close() }

    const store = createSqliteStore(directory)
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

    const constrained = new DatabaseSync(databasePath(directory))
    try {
      constrained.exec("PRAGMA foreign_keys=ON")
      assert.throws(() => constrained.prepare("DELETE FROM invoice_drafts WHERE organization_id='org-1' AND id='derived'").run())
      insertInvoice(constrained, { id: "ordinary-direct", draftId: null, sourceProformaId: null, number: 7 })
      insertInvoice(constrained, { id: "derived-invoice", draftId: "derived", sourceProformaId: "p-derived", series: "INV2", number: 1 })
      insertInvoice(constrained, { id: "normal-invoice", draftId: "normal", sourceProformaId: null, number: 1 })
      assert.throws(() => insertInvoice(constrained, { id: "missing-origin", draftId: "draft-first", sourceProformaId: null, number: 2 }))
      assert.throws(() => insertInvoice(constrained, { id: "unlinked", draftId: null, sourceProformaId: "p-unlinked", number: 3 }))
      constrained.exec("BEGIN IMMEDIATE")
      insertInvoice(constrained, { id: "direct-invoice", draftId: null, sourceProformaId: "p-direct", number: 4 })
      constrained.prepare("INSERT INTO proforma_invoice_conversions(proforma_id,organization_id,resulting_invoice_id,actor_id,converted_at)VALUES(?,?,?,?,?)").run(
        "p-direct", "org-1", "direct-invoice", "user-1", "2026-09-01T12:00:00.000Z",
      )
      constrained.exec("COMMIT")
      assert.throws(() => constrained.prepare("INSERT INTO proforma_conversions VALUES(?,?,?,?,?)").run(
        "p-direct", "org-1", "direct-target", "user-1", "2026-09-01T12:01:00.000Z",
      ))
      assert.throws(() => insertInvoice(constrained, {
        id: "direct-after-draft", draftId: null, sourceProformaId: "p-draft-first", number: 5,
      }))
      assert.throws(() => insertInvoice(constrained, {
        id: "cross-tenant", organizationId: "org-1", draftId: null, sourceProformaId: "p-other", number: 6,
      }))
      assert.throws(() => constrained.prepare("UPDATE proforma_conversions SET actor_id='other' WHERE proforma_id='p-derived'").run())
      assert.throws(() => constrained.prepare("UPDATE issued_invoices SET source_proforma_id=NULL WHERE id='derived-invoice'").run())
      constrained.prepare("UPDATE document_series SET series='RENAMED' WHERE organization_id='org-1' AND document_type='invoice' AND series='INV2'").run()
      assert.equal(constrained.prepare("SELECT 1 FROM pragma_table_info('proformas') WHERE name='invoice_series'").get(), undefined)
    } finally { constrained.close() }

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
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

void test("saveProformaConversion persists once inside the existing transaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-proforma-conversion-store-"))
  try {
    applyMigrations(directory)
    const database = new DatabaseSync(databasePath(directory))
    try {
      database.exec("PRAGMA foreign_keys=ON")
      database.exec("INSERT INTO document_series VALUES('org-1','invoice','INV'),('org-1','proforma','PRO')")
      insertDraft(database, "derived")
      insertProforma(database, "proforma")
    } finally { database.close() }
    const conversion: ProformaConversion = { proformaId: "proforma", organizationId: "org-1", resultingDraftId: "derived",
      actorId: "user-1", convertedAt: "2026-09-01T12:00:00.000Z" }
    const store = createSqliteStore(directory)
    await Effect.runPromise(store.transaction((transaction) => transaction.saveProformaConversion(conversion)))
    assert.deepEqual(await Effect.runPromise(store.transaction((transaction) => transaction.findProformaConversion("org-1", "proforma"))), conversion)
    const duplicate = await Effect.runPromise(Effect.flip(store.transaction((transaction) => transaction.saveProformaConversion(conversion))))
    assert.equal(duplicate instanceof DomainConflict && duplicate.code === "proforma_already_converted", true)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
