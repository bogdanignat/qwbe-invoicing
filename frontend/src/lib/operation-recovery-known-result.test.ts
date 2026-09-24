import assert from "node:assert/strict"
import test from "node:test"

import { knownResultNotice } from "./operation-recovery-view.ts"

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
