import assert from "node:assert/strict"
import test from "node:test"

import { authoringRecoveryDerived, issuanceAllowed } from "./invoice-authoring-derived.ts"
import { recoveryNotice } from "./operation-recovery-view.ts"
import type { KnownWrite } from "./operation-recovery-view.ts"
import type { RecoveryRecord } from "./operation-recovery-types.ts"

/**
 * The state the authoring screen actually gates its buttons on. Two sources can
 * hold a write open — the journal (an intent written down before the request
 * left) and the issuance controller's own confirmed result whose follow-up on
 * the screen failed — and the screen has one save button and one issue button,
 * so both sources must close both buttons.
 */

const issuedButUnfollowed: KnownWrite = {
  kind: "invoice", id: "inv-7", effectsError: new Error("navigare eșuată"),
}

const pendingRecord: RecoveryRecord = {
  version: 1,
  operation: "create-draft",
  key: "key-1",
  request: { kind: "create-draft", body: { series: "FAC" } },
  fingerprint: "fp-1",
  createdAt: "2026-09-24T10:00:00.000Z",
  summary: { buyerName: "Client SRL", series: "FAC", issueDate: "2026-09-24", lineCount: 2 },
  state: "pending",
}

const open = { requested: true, workflowPending: false, issuePending: false }

void test("a confirmed issuance the screen could not follow closes save and issue at once", () => {
  const state = authoringRecoveryDerived({
    journalNotice: undefined, journalBlocked: false, issuanceKnownResult: issuedButUnfollowed,
  })
  assert.equal(state.blocked, true, "salvarea rămâne blocată: formularul e același document")
  assert.equal(issuanceAllowed({ ...open, knownResult: issuedButUnfollowed }), false)
  assert.ok(state.notice !== undefined)
  assert.equal(state.notice.link?.href, "/invoices/inv-7")
  assert.equal(state.notice.replay, undefined)
  assert.equal(state.notice.dismissible, true)
  assert.equal(state.acknowledges, "issuance")
  // The notice already explains the failed follow-up: the bare error would be a
  // second message for the same event.
  assert.equal(state.suppressIssuanceError, true)
})

void test("the explicit dismiss is what reopens both buttons, not time and not a new key", () => {
  const dismissed = authoringRecoveryDerived({
    journalNotice: undefined, journalBlocked: false, issuanceKnownResult: undefined,
  })
  assert.equal(dismissed.blocked, false)
  assert.equal(dismissed.notice, undefined)
  assert.equal(dismissed.acknowledges, "none")
  assert.equal(dismissed.suppressIssuanceError, false)
  assert.equal(issuanceAllowed({ ...open, knownResult: undefined }), true)
})

void test("the journal keeps precedence: its intent may still need a replay", () => {
  const journalNotice = recoveryNotice({ kind: "record", record: pendingRecord })
  const state = authoringRecoveryDerived({
    journalNotice, journalBlocked: true, issuanceKnownResult: issuedButUnfollowed,
  })
  assert.ok(state.notice !== undefined)
  assert.equal(state.notice, journalNotice)
  assert.equal(state.notice.replay, pendingRecord)
  assert.equal(state.blocked, true)
  // Dismissing here acknowledges the journal; the issuance result stays and
  // surfaces on the next render, so the known write is never lost silently.
  assert.equal(state.acknowledges, "journal")
  assert.equal(state.suppressIssuanceError, false)
})

void test("a journal that has not hydrated blocks without a notice to dismiss", () => {
  const state = authoringRecoveryDerived({
    journalNotice: undefined, journalBlocked: true, issuanceKnownResult: undefined,
  })
  assert.equal(state.blocked, true)
  assert.equal(state.notice, undefined)
  assert.equal(state.acknowledges, "none")
})

void test("an issuance whose follow-up succeeded blocks nothing", () => {
  const state = authoringRecoveryDerived({
    journalNotice: undefined, journalBlocked: false,
    issuanceKnownResult: { kind: "invoice", id: "inv-8", effectsError: undefined },
  })
  assert.equal(state.blocked, false)
  assert.equal(state.notice, undefined)
  assert.equal(issuanceAllowed({ ...open, knownResult: undefined }), true)
})

void test("issuance stays closed while the draft workflow or the issue itself is in flight", () => {
  assert.equal(issuanceAllowed({ ...open, workflowPending: true, knownResult: undefined }), false)
  assert.equal(issuanceAllowed({ ...open, issuePending: true, knownResult: undefined }), false)
  assert.equal(issuanceAllowed({ ...open, requested: false, knownResult: undefined }), false)
})
