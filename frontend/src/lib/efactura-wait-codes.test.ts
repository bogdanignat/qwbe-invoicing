import assert from "node:assert/strict"
import test from "node:test"

import { panelView } from "./efactura-document.ts"
import { historyRows } from "./efactura-history.ts"
import type { EFacturaSubmission } from "./efactura-submissions.ts"
import { submissionMessages, waitReason } from "./efactura-wait-codes.ts"

const queued: EFacturaSubmission = {
  id: "sub-1", environment: "test", documentKind: "invoice", documentId: "inv-1", cif: "19999919", state: "queued",
  archiveState: "none", uploadIndex: null, errors: ["conexiune_alt_cif", "neconectat"], superseded: false,
  createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:00:00.000Z",
}
const history = { current: queued, submissions: [queued], resubmissions: [] }

void test("a wait code reads as the same sentence in the panel and in the history", () => {
  const sentence = waitReason(queued)
  assert.match(sentence ?? "", /^Trimiterea așteaptă: conexiunea ANAF este verificată pentru alt CIF/u)
  assert.equal(panelView("invoice", history, "connected").reason, sentence)
  assert.equal(historyRows(history)[0]?.errors[0], sentence)
})

void test("only a queued submission's errors are wait codes; an unknown code and ANAF's words stay as written", () => {
  assert.deepEqual(submissionMessages({ ...queued, errors: ["altceva"] }), ["altceva"])
  assert.equal(waitReason({ ...queued, errors: ["altceva"] }), undefined)
  const rejected: EFacturaSubmission = { ...queued, state: "rejected", uploadIndex: "5001", errors: ["neconectat"] }
  assert.deepEqual(submissionMessages(rejected), ["neconectat"])
  assert.equal(waitReason(rejected), undefined)
})
