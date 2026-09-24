import assert from "node:assert/strict"
import test from "node:test"

import {
  draftWith, editable, form, harness, networkFailure, serverLine,
} from "./invoice-draft-save-controller.test.ts"
import { createInvoiceIssuanceController } from "./invoice-issuance-controller.ts"
import { createOperationIdempotency } from "./operation-idempotency.ts"
import { ApiFailure } from "./api-errors.ts"

/**
 * The lost-answer races: draft and line writes carry no server idempotency, so
 * nothing here is retried blindly — every resume is reconciled against a fresh
 * read, and every answer the reconciliation cannot attribute blocks the save
 * instead of risking a duplicate line.
 */

void test("a create whose answer was lost blocks the save: no id came back to reconcile with", async () => {
  const setup = harness({ createDraft: () => { throw networkFailure() } })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "unconfirmed")
  assert.ok(outcome.message.includes("Rezultatul salvării nu este confirmat"))
  assert.ok(setup.effects.includes("invalidateDrafts"))
  assert.equal(setup.effects.some((effect) => effect.startsWith("recordDraft")), false)
  // A resubmit would risk a second draft: it is blocked, not retried.
  const again = await setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(again.kind, "unconfirmed")
  assert.equal(setup.calls.filter((call) => call.method === "createDraft").length, 1)
})

void test("a line create whose answer was lost is reconciled from the fresh read, not re-sent", async () => {
  const persisted = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const setup = harness({
    createDraft: () => draftWith("draft-1", []),
    addDraftLine: () => { throw networkFailure() },
    getDraft: () => persisted,
  })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [editable("k1", "Consultanță", "100.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "saved")
  // The line was sent exactly once: the fresh read confirmed it landed.
  assert.equal(setup.calls.filter((call) => call.method === "addDraftLine").length, 1)
  assert.equal(setup.calls.filter((call) => call.method === "getDraft").length, 1)
  assert.ok(setup.effects.includes("recordDraft:draft-1"))
})

void test("a line create the fresh read cannot see is re-sent exactly once", async () => {
  const withLine = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const setup = harness({
    createDraft: () => draftWith("draft-1", []),
    addDraftLine: (_args, call) => (call === 1 ? Promise.reject(networkFailure()) : Promise.resolve(withLine)),
    getDraft: () => draftWith("draft-1", []),
  })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [editable("k1", "Consultanță", "100.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "saved")
  assert.equal(setup.calls.filter((call) => call.method === "addDraftLine").length, 2)
})

void test("a line create whose retry also loses its answer blocks the save", async () => {
  const setup = harness({
    createDraft: () => draftWith("draft-1", []),
    addDraftLine: () => { throw networkFailure() },
    getDraft: () => draftWith("draft-1", []),
  })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [editable("k1", "Consultanță", "100.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "unconfirmed")
  assert.equal(setup.calls.filter((call) => call.method === "addDraftLine").length, 2)
  const again = await setup.controller.save({
    draft: draftWith("draft-1", []), form: form(), lines: [editable("k1", "Consultanță", "100.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: false,
  })
  assert.equal(again.kind, "unconfirmed")
})

void test("a fresh read that cannot be interpreted blocks the save instead of guessing", async () => {
  const setup = harness({
    createDraft: () => draftWith("draft-1", []),
    addDraftLine: () => { throw networkFailure() },
    getDraft: () => draftWith("draft-1", [
      serverLine("line-1", "Consultanță", "100.00"), serverLine("line-2", "Consultanță", "100.00"),
    ]),
  })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [editable("k1", "Consultanță", "100.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "unconfirmed")
  assert.equal(setup.calls.filter((call) => call.method === "addDraftLine").length, 1)
})

void test("a header update whose answer was lost is reconciled, not re-sent, when it landed", async () => {
  const updated = draftWith("draft-1", [], { issueDate: "2026-02-02" })
  const setup = harness({
    updateDraft: () => { throw networkFailure() },
    getDraft: () => updated,
  })
  const outcome = await setup.controller.save({
    draft: draftWith("draft-1", []), form: form({ issueDate: "2026-02-02" }),
    lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: false,
  })
  assert.equal(outcome.kind, "saved")
  assert.equal(setup.calls.filter((call) => call.method === "updateDraft").length, 1)
})

void test("a header update the fresh read cannot see is re-sent once", async () => {
  const updated = draftWith("draft-1", [], { issueDate: "2026-02-02" })
  let call = 0
  const setup = harness({
    updateDraft: () => { call += 1; return call === 1 ? Promise.reject(networkFailure()) : Promise.resolve(updated) },
    getDraft: () => draftWith("draft-1", []),
  })
  const outcome = await setup.controller.save({
    draft: draftWith("draft-1", []), form: form({ issueDate: "2026-02-02" }),
    lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: false,
  })
  assert.equal(outcome.kind, "saved")
  assert.equal(setup.calls.filter((entry) => entry.method === "updateDraft").length, 2)
})

void test("a session that ended before the create leaves no state behind", async () => {
  const setup = harness({
    createDraft: () => {
      setup.session.owns = false
      return draftWith("draft-1", [])
    },
  })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(setup.effects, [])
})

void test("a screen that unmounted mid-save receives no effects", async () => {
  const setup = harness({
    createDraft: () => {
      setup.session.alive = false
      return draftWith("draft-1", [])
    },
  })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(setup.effects, [])
})

void test("a session that ended before a chained write sends nothing further", async () => {
  const setup = harness({
    createDraft: () => draftWith("draft-1", []),
    addDraftLine: () => {
      setup.session.owns = false
      throw networkFailure()
    },
    getDraft: () => draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")]),
  })
  const outcome = await setup.controller.save({
    draft: undefined, form: form(), lines: [editable("k1", "Consultanță", "100.00")],
    forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(outcome.kind, "aborted")
  assert.equal(setup.calls.filter((entry) => entry.method === "getDraft").length, 0)
  assert.deepEqual(setup.effects.filter((effect) => effect !== "recordDraft:draft-1"), [])
})

void test("a draft delete whose answer was lost is reconciled before it is re-sent", async () => {
  let deleted = false
  const setup = harness({
    deleteDraft: () => {
      if (deleted) return Promise.resolve(undefined)
      deleted = true
      throw networkFailure()
    },
    getDraft: () => { throw new ApiFailure({ message: "nu există", status: 404 }) },
  })
  const outcome = await setup.controller.deleteDraft(draftWith("draft-1", []))
  assert.equal(outcome.kind, "saved")
  assert.equal(setup.calls.filter((entry) => entry.method === "deleteDraft").length, 1)
  assert.equal(setup.calls.filter((entry) => entry.method === "getDraft").length, 1)
  assert.ok(setup.effects.includes("navigate:/invoices"))
})

void test("a draft delete that the fresh read still sees is sent again", async () => {
  let calls = 0
  const setup = harness({
    deleteDraft: () => { calls += 1; return calls === 1 ? Promise.reject(networkFailure()) : Promise.resolve(undefined) },
    getDraft: () => draftWith("draft-1", []),
  })
  const outcome = await setup.controller.deleteDraft(draftWith("draft-1", []))
  assert.equal(outcome.kind, "saved")
  assert.equal(setup.calls.filter((entry) => entry.method === "deleteDraft").length, 2)
})

void test("a delete whose answer arrives after the session ended navigates nowhere", async () => {
  const setup = harness({
    deleteDraft: () => {
      setup.session.owns = false
      return undefined
    },
  })
  const outcome = await setup.controller.deleteDraft(draftWith("draft-1", []))
  assert.equal(outcome.kind, "aborted")
  assert.deepEqual(setup.effects, [])
})

void test("a line delete whose answer was lost is reconciled against the fresh read", async () => {
  const withLine = draftWith("draft-1", [serverLine("line-1", "Consultanță", "100.00")])
  const setup = harness({
    deleteDraftLine: () => { throw networkFailure() },
    getDraft: () => draftWith("draft-1", []),
  })
  const outcome = await setup.controller.deleteLine(withLine, editable("k1", "Consultanță", "100.00", "line-1"))
  assert.equal(outcome.kind, "saved")
  assert.equal(setup.calls.filter((entry) => entry.method === "deleteDraftLine").length, 1)
  assert.ok(setup.effects.includes("removeLine:k1"))
})

void test("a create whose outcome is unknown blocks issuance: the composition sends no issue request", async () => {
  const setup = harness({ createDraft: () => { throw networkFailure() } })
  const save = await setup.controller.save({
    draft: undefined, form: form(), lines: [], forcedUpdateLineIds: () => [], navigateOnCreate: true,
  })
  assert.equal(save.kind, "unconfirmed")
  const blockedMessage = setup.controller.unconfirmedMessage()
  assert.equal(blockedMessage !== undefined, true)
  // The issuance controller wired the way the session wires it: the save's
  // unknown outcome is the issuance's blocked message.
  const issued: string[] = []
  const issuance = createInvoiceIssuanceController({
    client: {
      getDraft: () => { throw new Error("unscripted getDraft") },
      issueDraft: () => { issued.push("issueDraft"); throw new Error("unscripted issueDraft") },
      issueInvoice: () => { issued.push("issueInvoice"); throw new Error("unscripted issueInvoice") },
    },
    idempotency: createOperationIdempotency(),
    csrfToken: () => "csrf-token",
    epoch: () => 1,
    ownsEpoch: () => true,
    alive: () => true,
    effects: {
      onIssued: () => { throw new Error("unscripted onIssued") },
      onOutcomeUnknown: () => { throw new Error("unscripted onOutcomeUnknown") },
    },
  })
  const outcome = await issuance.issue({
    draftId: undefined,
    payload: {
      customer: draftWith("draft-1", []).customer, series: "FCT", issueDate: "2026-01-01",
      currency: "RON", dueDate: null, notes: null, lines: [],
    },
    blockedMessage,
  })
  assert.equal(outcome.kind, "error")
  assert.deepEqual(issued, [])
  assert.equal(setup.calls.filter((call) => call.method === "createDraft").length, 1)
})
