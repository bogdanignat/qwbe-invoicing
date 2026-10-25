import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { PersistenceFailure, ValidationFailure, type InvoicingDependencies } from "../../cubes/invoicing/index.ts"
import { failure, numberingService, once, run } from "./numbering.test-support.ts"
import { withMigrated, type RawSql } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * T-2081: a series numbers continuously across years (Codul fiscal art. 319
 * alin. 20 lit. b). Series + number identify a document for its whole life;
 * whoever wants to start again from 1 opens a new series.
 */

const numbered = (documents: ReadonlyArray<{ readonly series: string; readonly number: number }>) =>
  documents.map(({ series, number }) => `${series}/${String(number)}`)

const counters = (sql: RawSql) => sql.query(
  "SELECT organization_id,document_type,series,last_number FROM invoice_sequences ORDER BY organization_id,document_type,series")

const refusedBefore = async (effect: Effect.Effect<unknown, unknown>, latest: string) => {
  const refused = await failure(effect)
  assert.ok(refused instanceof ValidationFailure, String(refused))
  assert.match(refused.issues.join(" "), new RegExp(`issueDate cannot be before ${latest}`, "u"))
}

void test("every invoice entry point and the proformas continue their series into the new year", async () => {
  await withMigrated("numbering_years", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    const december = await run(org.invoice("2026-12-31"))
    const proforma = await run(org.proforma("2026-12-31"))
    const fromDraft = await run(org.fromDraft("2027-01-02"))
    // The conversion takes the next invoice number, not the proforma's.
    const converted = await run(org.convert(proforma.id, "2027-01-02"))
    const direct = await run(org.invoice("2027-01-03"))
    const nextProforma = await run(org.proforma("2027-01-03"))
    assert.deepEqual(numbered([december, fromDraft, converted, direct]), ["FCT/1", "FCT/2", "FCT/3", "FCT/4"])
    assert.deepEqual(numbered([proforma, nextProforma]), ["FCT/1", "FCT/2"])
    // The year stays on the document as information only.
    assert.deepEqual(await sql.query("SELECT number,fiscal_year FROM issued_invoices ORDER BY number"), [
      { number: 1, fiscal_year: 2026 }, { number: 2, fiscal_year: 2027 }, { number: 3, fiscal_year: 2027 }, { number: 4, fiscal_year: 2027 },
    ])
    assert.deepEqual(await counters(sql), [
      { organization_id: "org-1", document_type: "invoice", series: "FCT", last_number: 4 },
      { organization_id: "org-1", document_type: "proforma", series: "FCT", last_number: 2 },
    ])
  })
})

void test("a storno shares the invoice counter and the series chronology across the year", async () => {
  await withMigrated("numbering_storno", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    const first = await run(org.invoice("2026-12-30"))
    const second = await run(org.invoice("2026-12-31"))
    const storno = await run(org.storno(second.id, "2027-01-02"))
    assert.deepEqual(numbered([first, second, storno]), ["FCT/1", "FCT/2", "FCT/3"])
    // An invoice after a storno of the new year cannot go back into December.
    await refusedBefore(org.invoice("2026-12-31"), "2027-01-02")
    const january = await run(org.invoice("2027-01-05"))
    assert.deepEqual(numbered([january]), ["FCT/4"])
    // A storno after an invoice: the date is later than the original invoice, so
    // only the series chronology refuses it.
    await refusedBefore(org.storno(first.id, "2027-01-04"), "2027-01-05")
    await run(org.proforma("2027-01-02"))
    await refusedBefore(org.proforma("2026-12-31"), "2027-01-02")
    // None of the refusals consumed a number.
    assert.deepEqual(numbered([await run(org.invoice("2027-01-05"))]), ["FCT/5"])
    assert.deepEqual((await counters(sql)).map(({ last_number }) => last_number), [5, 1])
  })
})

void test("a new series, another organization and the other document type each count from 1", async () => {
  await withMigrated("numbering_scopes", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    const other = await numberingService(pool, "org-2")
    await run(org.invoice("2026-12-31"))
    await run(org.invoice("2027-01-02"))
    const fresh = await run(org.invoice("2027-01-02", "FCT2027"))
    const otherOrganization = await run(other.invoice("2027-01-02"))
    const proforma = await run(org.proforma("2027-01-02"))
    assert.deepEqual(numbered([fresh, otherOrganization, proforma]), ["FCT2027/1", "FCT/1", "FCT/1"])
    assert.deepEqual(numbered([await run(org.invoice("2027-01-03"))]), ["FCT/3"])
    assert.deepEqual(await counters(sql), [
      { organization_id: "org-1", document_type: "invoice", series: "FCT", last_number: 3 },
      { organization_id: "org-1", document_type: "invoice", series: "FCT2027", last_number: 1 },
      { organization_id: "org-1", document_type: "proforma", series: "FCT", last_number: 1 },
      { organization_id: "org-2", document_type: "invoice", series: "FCT", last_number: 1 },
    ])
  })
})

const failingSave = (store: InvoicingDependencies["store"]): InvoicingDependencies["store"] => ({
  transaction: (use) => store.transaction((transaction) => use({
    ...transaction, saveIdempotencyRecord: () => Effect.fail(new PersistenceFailure({ operation: "injected" })),
  })),
})

void test("a rolled-back issuance leaves no gap and a replay across the year does not reallocate", async () => {
  await withMigrated("numbering_atomic", async ({ pool }) => {
    const org = await numberingService(pool)
    const request = org.invoiceRequest("2026-12-31")
    org.on("2026-12-31")
    const december = await run(org.service.issueInvoice(once(request, "december")))
    org.on("2027-01-02")
    const faulty = org.serviceOn(failingSave(createPostgresStore(pool)))
    const rolledBack = await failure(faulty.issueInvoice(once(org.invoiceRequest("2027-01-02"))))
    assert.ok(rolledBack instanceof PersistenceFailure)
    const replay = await run(org.service.issueInvoice(once(request, "december")))
    assert.equal(replay.id, december.id)
    assert.deepEqual(numbered([december, replay, await run(org.invoice("2027-01-02"))]), ["FCT/1", "FCT/1", "FCT/2"])
  })
})
