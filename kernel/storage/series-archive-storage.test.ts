import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict, type InvoicingDependencies } from "../../cubes/invoicing/index.ts"
import { failure, numberingService, once, run } from "./numbering.test-support.ts"
import { withMigrated, type RawSql } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * T-2082 on PostgreSQL: the archived flag is a column of `document_series`, an
 * open draft may move to another invoice series, and the check that a series is
 * active runs under the business lock in the transaction that numbers.
 */

const archived = (refused: unknown) => {
  assert.ok(refused instanceof DomainConflict, String(refused))
  assert.equal(refused.code, "document_series_archived")
}
const fct = { documentType: "invoice" as const, series: "FCT" }
const numbered = (document: { readonly series: string; readonly number: number }) => `${document.series}/${String(document.number)}`
const lastNumber = async (sql: RawSql, series = "FCT") => (await sql.query<{ readonly last_number: number }>(
  "SELECT last_number FROM invoice_sequences WHERE document_type='invoice' AND series=$1", [series]))[0]?.last_number

void test("the archived flag is stored, read back by a new store, audited once per change and held to 0 or 1", async () => {
  await withMigrated("series_archive_flag", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    await run(org.service.setDocumentSeriesArchived({ ...fct, archived: true }))
    await run(org.service.setDocumentSeriesArchived({ ...fct, archived: true }))
    const restarted = org.serviceOn(createPostgresStore(pool))
    assert.deepEqual((await run(restarted.listDocumentSeries())).map((item) => `${item.documentType}:${item.series}:${String(item.archived)}`),
      ["invoice:FCT:true", "invoice:FCT2027:false", "proforma:FCT:false"])
    assert.deepEqual(await sql.query("SELECT document_type,archived FROM document_series WHERE series='FCT' ORDER BY document_type"),
      [{ document_type: "invoice", archived: 1 }, { document_type: "proforma", archived: 0 }])
    await run(restarted.setDocumentSeriesArchived({ ...fct, archived: false }))
    assert.deepEqual(await sql.query("SELECT action,target_id FROM audit_events WHERE action IN('series.archived','series.reactivated') ORDER BY action"),
      [{ action: "series.archived", target_id: "invoice:FCT" }, { action: "series.reactivated", target_id: "invoice:FCT" }])
    assert.equal((await sql.rejects("UPDATE document_series SET archived=2 WHERE series='FCT'")).code, "23514")
  })
})

void test("an open draft moves to an active series, is persisted there and issues in it", async () => {
  await withMigrated("series_archive_draft", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    org.on("2026-12-31")
    const draft = await run(org.service.createDraft(once(org.invoiceRequest("2026-12-31"))))
    await run(org.service.setDocumentSeriesArchived({ ...fct, archived: true }))
    archived(await failure(org.service.issueInvoice(once({ draftId: draft.id }))))
    const header = { draftId: draft.id, customer: draft.customer, issueDate: draft.issueDate, dueDate: draft.dueDate }
    await run(org.service.updateDraft({ ...header, series: "FCT2027" }))
    assert.equal((await run(org.serviceOn(createPostgresStore(pool)).getDraft(draft.id))).series, "FCT2027")
    assert.deepEqual(await sql.query("SELECT series FROM invoice_drafts WHERE id=$1", [draft.id]), [{ series: "FCT2027" }])
    const invoice = await run(org.service.issueInvoice(once({ draftId: draft.id })))
    assert.deepEqual([numbered(invoice), invoice.draftId], ["FCT2027/1", draft.id])
    assert.equal(await lastNumber(sql), undefined)
  })
})

void test("a refusal takes no number, a storno stays in the archived series and reactivation continues it", async () => {
  await withMigrated("series_archive_numbering", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    const first = await run(org.invoice("2026-12-31"))
    const proforma = await run(org.proforma("2026-12-31"))
    await run(org.service.setDocumentSeriesArchived({ ...fct, archived: true }))
    await run(org.service.setDocumentSeriesArchived({ documentType: "proforma", series: "FCT", archived: true }))
    archived(await failure(org.invoice("2027-01-02")))
    archived(await failure(org.fromDraft("2027-01-02")))
    archived(await failure(org.proforma("2027-01-02")))
    archived(await failure(org.convert(proforma.id, "2027-01-02")))
    assert.equal(await lastNumber(sql), 1)
    assert.equal(numbered(await run(org.storno(first.id, "2027-01-02"))), "FCT/2")
    await run(org.service.setDocumentSeriesArchived({ ...fct, archived: false }))
    assert.equal(numbered(await run(org.convert(proforma.id, "2027-01-03"))), "FCT/3")
    assert.deepEqual(await sql.query("SELECT series,number FROM issued_invoices WHERE id=$1", [first.id]), [{ series: "FCT", number: 1 }])
  })
})

/** A store whose transaction does its work and then waits, before committing and still holding the business lock. */
const held = (store: InvoicingDependencies["store"]) => {
  let arrive = () => {}
  let release = () => {}
  const arrived = new Promise<void>((resolve) => { arrive = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  const heldStore: InvoicingDependencies["store"] = {
    transaction: (use) => store.transaction((transaction) =>
      Effect.tap(use(transaction), () => Effect.promise(async () => { arrive(); await released }))),
  }
  return { arrived, release, store: heldStore }
}

/** Until the other transaction is queued on the business lock of this database. */
const queuedOnLock = async (sql: RawSql) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await sql.query<{ readonly waiting: number }>(`SELECT count(*)::int AS waiting FROM pg_locks
      WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())`)
    if ((row?.waiting ?? 0) > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.fail("the second transaction never waited on the business lock")
}

void test("an archive committed first refuses the issuance queued behind it, without a number", async () => {
  await withMigrated("series_archive_race_archive", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    const holder = held(createPostgresStore(pool))
    const archiving = run(org.serviceOn(holder.store).setDocumentSeriesArchived({ ...fct, archived: true }))
    await holder.arrived
    const issuing = failure(org.invoice("2026-12-31"))
    await queuedOnLock(sql)
    holder.release()
    assert.equal((await archiving).archived, true)
    archived(await issuing)
    assert.equal(await lastNumber(sql), undefined)
  })
})

void test("an issuance committed first keeps its number and the archive queued behind it still lands", async () => {
  await withMigrated("series_archive_race_issue", async ({ pool, sql }) => {
    const org = await numberingService(pool)
    const holder = held(createPostgresStore(pool))
    org.on("2026-12-31")
    const issuing = run(org.serviceOn(holder.store).issueInvoice(once(org.invoiceRequest("2026-12-31"))))
    await holder.arrived
    const archiving = run(org.service.setDocumentSeriesArchived({ ...fct, archived: true }))
    await queuedOnLock(sql)
    holder.release()
    assert.equal(numbered(await issuing), "FCT/1")
    assert.equal((await archiving).archived, true)
    archived(await failure(org.invoice("2026-12-31")))
    assert.equal(await lastNumber(sql), 1)
  })
})
