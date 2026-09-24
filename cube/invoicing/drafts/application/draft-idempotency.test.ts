import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService } from "../../application/invoicing.ts"
import {
  brandingNormalizer, contextProvider, each, emptyState, expectConflict, fixedClock, identity,
  memoryStore, sequentialIds, type MemoryState,
} from "../../application/memory-store.test-support.ts"
import { DomainConflict, ValidationFailure } from "../../contracts/index.ts"

const buyer = {
  partyType: "individual" as const, name: "Ion Popescu", fiscalIdentifier: "", vatRegistered: false,
  address: { countryCode: "RO", city: "Cluj-Napoca", street: "Strada Unu 1", county: "RO-CJ" },
}
const line = { description: "Consultanță", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }
const header = { customer: buyer, series: "QWBE", issueDate: "2025-08-01" }
// The fingerprint stands in for the hash the HTTP layer computes: what matters
// to the cube is that the same request carries the same value and a different
// request does not.
const attempt = (key: string, fingerprint = "a") => ({ key, fingerprint: `sha256:${fingerprint.repeat(64).slice(0, 64)}` })

const serviceOn = (state: MemoryState) => createInvoicingService({
  context: contextProvider({ identity, organization: { id: "org-1" } }), clock: fixedClock,
  ids: sequentialIds(), store: memoryStore(state), branding: brandingNormalizer, cubeIdentity: "invoicing",
})

const setup = async (state: MemoryState = emptyState()) => {
  const service = serviceOn(state)
  await Effect.runPromise(service.configureIssuer({
    name: "Exemplu SRL", fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1", county: "RO-BT" },
    legalForm: "srl", tradeRegistryNumber: "J40/123/2020", socialCapital: "200.00", iban: "", bankName: "",
    defaultCurrency: "RON", defaultPaymentTermDays: 15,
    branding: null, vatChange: { registered: true, effectiveFrom: "2025-08-01" },
  }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
  return { service, state }
}

void test("a draft may be created without lines, with none, or complete in one request", async () => {
  const { service } = await setup()
  const absent = await Effect.runPromise(service.createDraft({ request: header, idempotency: attempt("absent") }))
  assert.deepEqual(absent.lines, [])
  assert.equal(absent.totalIncludingVat, "0.00")
  // An explicit empty array means the same thing as no array: a draft is allowed
  // to be incomplete, and only issuance insists on a line.
  const empty = await Effect.runPromise(service.createDraft({ request: { ...header, lines: [] }, idempotency: attempt("empty") }))
  assert.deepEqual(empty.lines, [])
  const complete = await Effect.runPromise(service.createDraft({ request: { ...header, lines: [line, line] }, idempotency: attempt("complete") }))
  assert.equal(complete.lines.length, 2)
  assert.equal(complete.totalIncludingVat, "242.00")
  assert.equal(new Set(complete.lines.map((item) => item.id)).size, 2)
})

void test("issuance still refuses a document without lines, direct or from a draft", async () => {
  const { service } = await setup()
  const direct = await Effect.runPromise(Effect.flip(service.issueInvoice({
    request: { ...header, currency: "RON" as const, lines: [] }, idempotency: attempt("direct-empty"),
  })))
  assert.equal(direct instanceof ValidationFailure && direct.issues.includes("document must contain at least one line"), true)
  const draft = await Effect.runPromise(service.createDraft({ request: header, idempotency: attempt("for-issue") }))
  const fromDraft = await Effect.runPromise(Effect.flip(service.issueInvoice({ request: { draftId: draft.id }, idempotency: attempt("issue-empty") })))
  assert.equal(fromDraft instanceof ValidationFailure, true)
})

void test("a repeated creation key returns the one draft it made, however that draft has moved on", async () => {
  const { service, state } = await setup()
  const created = await Effect.runPromise(service.createDraft({ request: { ...header, lines: [line] }, idempotency: attempt("repeat") }))
  const replayed = await Effect.runPromise(service.createDraft({ request: { ...header, lines: [line] }, idempotency: attempt("repeat") }))
  assert.deepEqual(replayed, created)
  assert.equal(state.drafts.size, 1)
  // Edited after the fact, the replay reports the draft as it stands now, not as
  // the original answer described it.
  const edited = await Effect.runPromise(service.addDraftLine({ draftId: created.id, ...line }))
  const afterEdit = await Effect.runPromise(service.createDraft({ request: { ...header, lines: [line] }, idempotency: attempt("repeat") }))
  assert.deepEqual(afterEdit, edited)
  assert.equal(afterEdit.lines.length, 2)
  await Effect.runPromise(service.updateDraft({ customer: buyer, draftId: created.id, issueDate: header.issueDate, dueDate: "2025-08-15" }))
  await Effect.runPromise(service.issueInvoice({ request: { draftId: created.id }, idempotency: attempt("issue-it") }))
  const afterIssue = await Effect.runPromise(service.createDraft({ request: { ...header, lines: [line] }, idempotency: attempt("repeat") }))
  assert.equal(afterIssue.status, "issued")
  assert.equal(afterIssue.id, created.id)
  assert.equal(state.drafts.size, 1)
})

void test("a creation key whose draft was deleted is a dead end, never a second draft", async () => {
  const { service, state } = await setup()
  const created = await Effect.runPromise(service.createDraft({ request: header, idempotency: attempt("gone") }))
  await Effect.runPromise(service.deleteDraft(created.id))
  // Twice: the answer is the same conflict every time, not a recreation on retry.
  for (const retry of [1, 2]) {
    await expectConflict(service.createDraft({ request: header, idempotency: attempt("gone") }), "draft_creation_result_deleted")
    assert.equal(state.drafts.size, 0, `retry ${String(retry)}`)
  }
})

void test("the same creation key with a different request is refused as reused", async () => {
  const { service, state } = await setup()
  await Effect.runPromise(service.createDraft({ request: header, idempotency: attempt("same-key", "a") }))
  await expectConflict(service.createDraft({ request: { ...header, notes: "Alt" }, idempotency: attempt("same-key", "b") }), "idempotency_key_reused")
  assert.equal(state.drafts.size, 1)
  // A key already spent on another operation is refused too.
  await expectConflict(service.issueInvoice({ request: { draftId: "any" }, idempotency: attempt("same-key", "a") }), "idempotency_key_reused")
})

void test("a malformed creation key or fingerprint is refused before anything is written", async () => {
  const { service, state } = await setup()
  for (const idempotency of [{ key: "", fingerprint: attempt("x").fingerprint }, { key: "sp ace", fingerprint: attempt("x").fingerprint },
    { key: "fine", fingerprint: "not-a-hash" }]) {
    assert.equal(await Effect.runPromise(Effect.flip(service.createDraft({ request: header, idempotency }))) instanceof ValidationFailure, true)
  }
  assert.equal(state.drafts.size, 0)
  assert.equal(state.idempotency.size, 0)
})

void test("header, lines, idempotency record and audit entry commit together or not at all", async () => {
  const state = emptyState()
  await setup(state)
  const before = structuredClone(state)
  const baseStore = memoryStore(state)
  const auditFailing = createInvoicingService({
    context: contextProvider({ identity, organization: { id: "org-1" } }), clock: fixedClock,
    ids: sequentialIds(), branding: brandingNormalizer, cubeIdentity: "invoicing", store: {
      transaction: (use) => baseStore.transaction((transaction) => use({
        ...transaction,
        appendAuditEvent: () => Effect.fail(new DomainConflict({ code: "forced_audit_failure", message: "forced" })),
      })),
    },
  })
  await expectConflict(auditFailing.createDraft({ request: { ...header, lines: [line] }, idempotency: attempt("rolled-back") }), "forced_audit_failure")
  assert.deepEqual(state, before)
  assert.equal(state.drafts.size, 0)
  assert.equal(state.idempotency.size, 0)
  assert.equal(state.auditEvents.length, before.auditEvents.length)
  // The key survives the rollback unspent, so the honest retry succeeds.
  const service = serviceOn(state)
  const retried = await Effect.runPromise(service.createDraft({ request: { ...header, lines: [line] }, idempotency: attempt("rolled-back") }))
  assert.equal(retried.lines.length, 1)
  assert.equal(state.auditEvents.filter((event) => event.action === "draft.created").length, 1)
})
