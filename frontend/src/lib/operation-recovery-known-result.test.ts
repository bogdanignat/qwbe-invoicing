import assert from "node:assert/strict"
import test from "node:test"

import { knownResultNotice, recoveryNotice } from "./operation-recovery-view.ts"
import type { RecoveryOperation, RecoveryRecord } from "./operation-recovery-types.ts"

/**
 * The write is confirmed and the journal is clean; only the screen failed to
 * follow. The notice has to name the document and keep the normal save/issue
 * blocked, or the same form would author a second one under a fresh key.
 */

void test("no follow-up failure, no notice", () => {
  assert.equal(knownResultNotice(undefined), undefined)
  assert.equal(knownResultNotice({ kind: "draft", id: "draft-1", effectsError: undefined }), undefined)
  assert.equal(knownResultNotice({ kind: "invoice", id: "inv-1", effectsError: null }), undefined)
})

void test("a saved draft the screen could not open is named and linked, never replayed", () => {
  const notice = knownResultNotice({ kind: "draft", id: "draft 1/a", effectsError: new Error("navigare") })
  assert.ok(notice !== undefined)
  assert.equal(notice.replay, undefined)
  assert.equal(notice.dismissible, true)
  assert.equal(notice.link?.href, "/drafts/draft%201%2Fa")
  assert.match(notice.message, /Nu salva și nu emite din nou/)
})

void test("an issued invoice the screen could not open links to the invoice, not to the draft", () => {
  const notice = knownResultNotice({ kind: "invoice", id: "inv-1", effectsError: new Error("navigare") })
  assert.ok(notice !== undefined)
  assert.equal(notice.link?.href, "/invoices/inv-1")
  assert.equal(notice.replay, undefined)
  assert.match(notice.title, /Factura a fost emisă/)
})

void test("an issued proforma the screen could not open links to the proforma register", () => {
  const notice = knownResultNotice({ kind: "proforma", id: "prf 1", effectsError: new Error("navigare") })
  assert.ok(notice !== undefined)
  assert.equal(notice.link?.href, "/proformas/prf%201")
  assert.equal(notice.replay, undefined)
  assert.match(notice.title, /Proforma a fost emisă/)
})

const record = (operation: RecoveryOperation): RecoveryRecord => ({
  version: 1, operation, key: "key-1", request: { kind: "create-draft", body: {} },
  fingerprint: "fingerprint:1", createdAt: "2026-01-01T00:00:00.000Z",
  summary: { buyerName: "Alfa", series: "PRO", issueDate: "2026-01-01", lineCount: 1 },
  state: "pending",
})

void test("every operation the journal can hold has a title of its own", () => {
  const operations: ReadonlyArray<RecoveryOperation> = [
    "create-draft", "issue-invoice", "create-proforma", "convert-proforma-invoice", "convert-proforma-draft",
  ]
  const titles = operations.map((operation) => recoveryNotice({ kind: "record", record: record(operation) })?.title)
  // No blank card, and no two operations sharing one wording.
  assert.equal(titles.filter((title) => title !== undefined && title !== "").length, operations.length)
  assert.equal(new Set(titles).size, operations.length)
})

void test("a proforma conversion names the document it would produce", () => {
  const invoice = recoveryNotice({ kind: "record", record: record("convert-proforma-invoice") })
  const draft = recoveryNotice({ kind: "record", record: record("convert-proforma-draft") })
  assert.match(invoice?.title ?? "", /facturi din proformă|facturii din proformă/)
  assert.match(draft?.title ?? "", /draftului din proformă/)
})
