import assert from "node:assert/strict"
import test from "node:test"

import { ARCHIVE_POLL_MS, documentStatus, EFACTURA_POLL_MS, historyPollInterval, panelView } from "./efactura-document.ts"
import type { EFacturaHistory, EFacturaSubmission, FiscalState } from "./efactura-submissions.ts"

const submission = (state: FiscalState, patch: Partial<EFacturaSubmission> = {}): EFacturaSubmission => ({
  id: "sub-1", environment: "test", documentKind: "invoice", documentId: "inv-1", cif: "19999919", state,
  archiveState: "none", uploadIndex: state === "processing" || state === "accepted" || state === "rejected" ? "5001" : null,
  errors: [], superseded: false, createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:00:00.000Z", ...patch,
})
const historyOf = (current: EFacturaSubmission | null): EFacturaHistory =>
  ({ current, submissions: current === null ? [] : [current], resubmissions: [] })

void test("the document reads its current submission; validating and uploading are processing", () => {
  assert.equal(documentStatus(null), "not_sent")
  const states: ReadonlyArray<FiscalState> = ["queued", "validating", "uploading", "processing", "accepted", "rejected", "refused", "unknown"]
  assert.deepEqual(states.map((state) => documentStatus(submission(state))),
    ["queued", "processing", "processing", "processing", "accepted", "rejected", "refused", "unknown"])
})

void test("not sent and connected: the one button that sends", () => {
  const view = panelView("invoice", historyOf(null), "connected")
  assert.deepEqual([view.buttonLabel, view.canSubmit, view.reason, view.badgeLabel], ["Trimite în e-Factura", true, undefined, "Netrimisă"])
})

void test("not sent without a usable connection: disabled, and the reason names Integrări", () => {
  for (const connection of ["not_configured", "disconnected", "needs_reconnect", "loading", "unreadable"] as const) {
    const view = panelView("invoice", historyOf(null), connection)
    assert.equal(view.canSubmit, false, connection)
    assert.equal(view.buttonLabel, "Trimite în e-Factura")
    assert.ok(view.reason !== undefined && view.reason.length > 0, connection)
  }
  assert.match(panelView("invoice", historyOf(null), "disconnected").reason ?? "", /din Integrări/u)
})

void test("„not known yet” only while the connection is read; a failed read says so instead", () => {
  assert.equal(panelView("invoice", historyOf(null), "loading").reason, "Starea conexiunii ANAF nu este cunoscută încă.")
  const failed = panelView("invoice", historyOf(null), "unreadable").reason ?? ""
  assert.match(failed, /nu a putut fi citită/u)
  assert.doesNotMatch(failed, /încă/u)
})

void test("queued or processing: disabled, „Se procesează la ANAF”, and why a queued one waits", () => {
  for (const state of ["queued", "validating", "uploading", "processing"] as const) {
    const view = panelView("invoice", historyOf(submission(state)), "connected")
    assert.deepEqual([view.buttonLabel, view.canSubmit, view.badgeLabel], ["Se procesează la ANAF", false, "În procesare"], state)
  }
  const waiting = panelView("invoice", historyOf(submission("queued", { errors: ["conexiune_alt_cif"] })), "connected")
  assert.match(waiting.reason ?? "", /alt CIF/u)
  assert.deepEqual(waiting.errors, [], "a wait code is not an ANAF error")
})

void test("accepted: registered, with the upload index and ANAF's ZIP once stored", () => {
  const view = panelView("invoice", historyOf(submission("accepted", { archiveState: "stored" })), "disconnected")
  assert.deepEqual([view.buttonLabel, view.canSubmit, view.registered, view.responseStored], ["Înregistrată în e-Factura", false, true, true])
  assert.match(view.reason ?? "", /indexul de încărcare 5001/u)
  assert.equal(panelView("invoice", historyOf(submission("accepted", { archiveState: "pending" })), "connected").responseStored, false)
})

void test("only an accepted document is registered: every other state keeps the head button", () => {
  assert.equal(panelView("invoice", historyOf(null), "connected").registered, false)
  for (const state of ["queued", "validating", "uploading", "processing", "rejected", "refused", "unknown"] as const) {
    assert.equal(panelView("invoice", historyOf(submission(state)), "connected").registered, false, state)
  }
  assert.equal(panelView("correction", historyOf(submission("accepted")), "connected").registered, true)
})

void test("rejected or refused: ANAF's errors and „Retrimite”, which needs the connection too", () => {
  for (const state of ["rejected", "refused"] as const) {
    const current = submission(state, { errors: ["E1: lipsă"] })
    const view = panelView("correction", historyOf(current), "connected")
    assert.deepEqual([view.buttonLabel, view.canSubmit, view.errors, view.errorsTitle], ["Retrimite în e-Factura", true, ["E1: lipsă"], "Erorile ANAF"], state)
    assert.match(view.reason ?? "", /factura storno/u)
    const blocked = panelView("correction", historyOf(current), "disconnected")
    assert.equal(blocked.canSubmit, false)
    assert.match(blocked.reason ?? "", /nu este conectată/u)
    assert.match(blocked.detail ?? "", /Erorile sunt mai jos/u)
  }
})

void test("unknown: never sendable from the head; it explains and opens the reconciliation", () => {
  const view = panelView("invoice", historyOf(submission("unknown", { errors: ["întrerupt"] })), "connected")
  assert.deepEqual([view.canSubmit, view.reconcile, view.badgeLabel, view.errorsTitle], [false, true, "Necunoscut", "Motiv"])
  assert.match(view.reason ?? "", /^Nu știm dacă factura a ajuns la ANAF/u)
  assert.equal(panelView("invoice", historyOf(null), "connected").reconcile, false)
})

void test("the history is polled closely until ANAF decides, every minute while only its answer is fetched, never after", () => {
  assert.equal(historyPollInterval(undefined), false)
  assert.equal(historyPollInterval(historyOf(null)), false)
  for (const state of ["queued", "validating", "uploading", "processing"] as const) {
    assert.equal(historyPollInterval(historyOf(submission(state))), EFACTURA_POLL_MS, state)
    assert.equal(historyPollInterval(historyOf(submission(state, { archiveState: "pending" }))), EFACTURA_POLL_MS, state)
  }
  for (const state of ["accepted", "rejected", "refused", "unknown"] as const) {
    assert.equal(historyPollInterval(historyOf(submission(state))), false, state)
    assert.equal(historyPollInterval(historyOf(submission(state, { archiveState: "stored" }))), false, state)
    assert.equal(historyPollInterval(historyOf(submission(state, { archiveState: "pending" }))), ARCHIVE_POLL_MS, state)
  }
  assert.deepEqual([EFACTURA_POLL_MS, ARCHIVE_POLL_MS], [12_000, 60_000])
})
