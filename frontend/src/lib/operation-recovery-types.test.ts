import assert from "node:assert/strict"
import test from "node:test"

import { decodeJournalEntry } from "./operation-recovery-types.ts"

/**
 * Stored text is hostile input. The union of operations is closed, so the only
 * question the decoder answers is "is this exactly one of the writes this build
 * knows" — anything else is `corrupt`, which fails the next write closed rather
 * than replaying something half-understood.
 */

const stored = (operation: string, request: unknown): string => JSON.stringify({
  version: 1,
  operation,
  key: "key-1",
  request,
  fingerprint: "fingerprint:1",
  createdAt: "2026-01-01T00:00:00.000Z",
  summary: { buyerName: "Alfa", series: "PRO", issueDate: "2026-01-01", lineCount: 1 },
  state: "pending",
})

void test("a stored proforma issuance decodes with its body kept byte for byte", () => {
  const body = { series: "PRO", lines: [{ description: "Consultanță" }] }
  const entry = decodeJournalEntry(stored("create-proforma", { kind: "create-proforma", body }))
  assert.equal(entry.kind, "record")
  assert.equal(entry.record.operation, "create-proforma")
  assert.deepEqual(entry.record.request, { kind: "create-proforma", body })
})

void test("a stored conversion keeps the proforma it starts from", () => {
  for (const kind of ["convert-proforma-invoice", "convert-proforma-draft"]) {
    const request = { kind, proformaId: "prf-1", body: { invoiceSeries: "FCT" } }
    const entry = decodeJournalEntry(stored(kind, request))
    assert.equal(entry.kind, "record")
    assert.deepEqual(entry.record.request, request)
  }
})

void test("a conversion without the proforma id is corrupt, not a conversion of nothing", () => {
  const entry = decodeJournalEntry(stored("convert-proforma-invoice", {
    kind: "convert-proforma-invoice", body: { invoiceSeries: "FCT" },
  }))
  assert.equal(entry.kind, "corrupt")
})

void test("a conversion without a body is corrupt: a replay has nothing to send", () => {
  const entry = decodeJournalEntry(stored("convert-proforma-draft", {
    kind: "convert-proforma-draft", proformaId: "prf-1",
  }))
  assert.equal(entry.kind, "corrupt")
})

void test("an operation this build does not know is corrupt, never 'probably fine'", () => {
  const entry = decodeJournalEntry(stored("cancel-proforma", { kind: "create-proforma", body: {} }))
  assert.equal(entry.kind, "corrupt")
})

void test("a request kind this build does not know is corrupt too", () => {
  const entry = decodeJournalEntry(stored("create-proforma", { kind: "cancel-proforma", body: {} }))
  assert.equal(entry.kind, "corrupt")
})

void test("a stored record whose operation and request disagree is corrupt", () => {
  // The card would title "emiterea facturii din proformă" while a replay sent
  // POST /api/drafts: one confirmation, another write.
  const mismatched = decodeJournalEntry(stored("convert-proforma-invoice", { kind: "create-draft", body: {} }))
  assert.equal(mismatched.kind, "corrupt")
  const swapped = decodeJournalEntry(stored("create-proforma", {
    kind: "convert-proforma-draft", proformaId: "prf-1", body: {},
  }))
  assert.equal(swapped.kind, "corrupt")
  const crossedConversions = decodeJournalEntry(stored("convert-proforma-draft", {
    kind: "convert-proforma-invoice", proformaId: "prf-1", body: {},
  }))
  assert.equal(crossedConversions.kind, "corrupt")
})

void test("issuing is the one operation with two requests: both pairs stay valid", () => {
  const fromDraft = decodeJournalEntry(stored("issue-invoice", { kind: "issue-draft", draftId: "draft-1" }))
  assert.equal(fromDraft.kind, "record")
  assert.deepEqual(fromDraft.record.request, { kind: "issue-draft", draftId: "draft-1" })
  const direct = decodeJournalEntry(stored("issue-invoice", { kind: "issue-invoice", body: { series: "FCT" } }))
  assert.equal(direct.kind, "record")
  // The other direction of the same pair: a draft issuance may not be filed as a create.
  assert.equal(decodeJournalEntry(stored("create-draft", { kind: "issue-draft", draftId: "draft-1" })).kind, "corrupt")
})

void test("a marker for a proforma write decodes as that operation", () => {
  const entry = decodeJournalEntry(JSON.stringify({
    version: 1, kind: "marker", operation: "convert-proforma-draft", createdAt: "2026-01-01T00:00:00.000Z",
  }))
  assert.equal(entry.kind, "marker")
  assert.equal(entry.marker.operation, "convert-proforma-draft")
})

void test("a marker for an unknown operation is corrupt", () => {
  const entry = decodeJournalEntry(JSON.stringify({
    version: 1, kind: "marker", operation: "issue-proforma", createdAt: "2026-01-01T00:00:00.000Z",
  }))
  assert.equal(entry.kind, "corrupt")
})
