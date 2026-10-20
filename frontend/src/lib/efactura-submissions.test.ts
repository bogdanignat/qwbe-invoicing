import assert from "node:assert/strict"
import test from "node:test"

import { decodeEFacturaCandidates, decodeEFacturaHistory, decodeEFacturaSubmission } from "./efactura-submissions.ts"

const submissionJson = {
  id: "sub-1", environment: "test", documentKind: "invoice", documentId: "inv-1", standard: "UBL", cif: "19999919",
  state: "accepted", archiveState: "stored", uploadIndex: "5001", downloadId: "7001", errors: [], superseded: false,
  xmlSha256: "ab", xmlSize: 10, createdBy: "api-token", createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:05:00.000Z",
}

void test("a submission decodes to what the panel reads; bytes, digests and actors stay behind", () => {
  assert.deepEqual(decodeEFacturaSubmission(submissionJson), {
    id: "sub-1", environment: "test", documentKind: "invoice", documentId: "inv-1", cif: "19999919", state: "accepted",
    archiveState: "stored", uploadIndex: "5001", errors: [], superseded: false,
    createdAt: "2026-10-19T10:00:00.000Z", updatedAt: "2026-10-19T10:05:00.000Z",
  })
})

void test("a submission the screen cannot explain is refused", () => {
  const refused: ReadonlyArray<readonly [Readonly<Record<string, unknown>>, RegExp]> = [
    [{ state: "sent" }, /invalid state/u],
    [{ archiveState: "lost" }, /invalid archiveState/u],
    [{ documentKind: "proforma" }, /invalid documentKind/u],
    [{ environment: "staging" }, /invalid environment/u],
    [{ errors: [1] }, /invalid errors/u],
    [{ errors: "x" }, /invalid errors/u],
    [{ id: "" }, /invalid id/u],
    [{ state: "processing", uploadIndex: null }, /invalid uploadIndex/u],
    [{ state: "accepted", uploadIndex: null }, /invalid uploadIndex/u],
    [{ state: "accepted", superseded: true }, /invalid superseded/u],
  ]
  for (const [patch, error] of refused) assert.throws(() => decodeEFacturaSubmission({ ...submissionJson, ...patch }), error, JSON.stringify(patch))
  assert.equal(decodeEFacturaSubmission({ ...submissionJson, state: "unknown", uploadIndex: null, superseded: true }).superseded, true)
})

const unknown = { ...submissionJson, id: "sub-0", state: "unknown", archiveState: "none", uploadIndex: null, superseded: true }
const history = {
  current: submissionJson, submissions: [submissionJson, unknown],
  resubmissions: [{ previousId: "sub-0", nextId: "sub-1", actorId: "api-token", createdAt: "2026-10-19T09:59:00.000Z" }],
}

void test("the history is this document's, and its current submission is the newest still standing", () => {
  const decoded = decodeEFacturaHistory(history, "invoice", "inv-1")
  assert.equal(decoded.current?.id, "sub-1")
  assert.deepEqual(decoded.resubmissions, [{ previousId: "sub-0", nextId: "sub-1", createdAt: "2026-10-19T09:59:00.000Z" }])
  assert.throws(() => decodeEFacturaHistory(history, "correction", "inv-1"), /invalid submissions/u)
  assert.throws(() => decodeEFacturaHistory(history, "invoice", "inv-2"), /invalid submissions/u)
  assert.throws(() => decodeEFacturaHistory({ ...history, current: null }, "invoice", "inv-1"), /invalid current/u)
  assert.throws(() => decodeEFacturaHistory({ ...history, current: unknown }, "invoice", "inv-1"), /invalid current/u)
  assert.deepEqual(decodeEFacturaHistory({ current: null, submissions: [], resubmissions: [] }, "invoice", "inv-1").submissions, [])
})

const candidates = {
  page: 1, pages: 2, from: "2026-10-19T10:00:00.000Z", to: "2026-10-20T10:00:00.000Z",
  candidates: [{ uploadIndex: "5001", createdAt: "2026-10-19T10:01:00.000Z", type: "FACTURA TRIMISA", linked: false }],
}

void test("a candidates page decodes strictly", () => {
  assert.deepEqual(decodeEFacturaCandidates(candidates), candidates)
  assert.equal(decodeEFacturaCandidates({ ...candidates, pages: 0, candidates: [] }).pages, 0)
  assert.throws(() => decodeEFacturaCandidates({ ...candidates, page: 0 }), /invalid page/u)
  assert.throws(() => decodeEFacturaCandidates({ ...candidates, page: 1.5 }), /invalid page/u)
  assert.throws(() => decodeEFacturaCandidates({ ...candidates, candidates: [{ ...candidates.candidates[0], linked: "no" }] }), /invalid linked/u)
  assert.throws(() => decodeEFacturaCandidates({ ...candidates, from: "" }), /invalid from/u)
})
