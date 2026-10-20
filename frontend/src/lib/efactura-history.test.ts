import assert from "node:assert/strict"
import test from "node:test"

import { candidatesView, historyRows, linkConfirm, RESUBMIT_CONFIRM } from "./efactura-history.ts"
import type { EFacturaHistory, EFacturaSubmission } from "./efactura-submissions.ts"

const base: EFacturaSubmission = {
  id: "sub-2", environment: "prod", documentKind: "invoice", documentId: "inv-1", cif: "19999919", state: "accepted",
  archiveState: "stored", uploadIndex: "5002", errors: [], superseded: false,
  createdAt: "2026-10-19T11:00:00.000Z", updatedAt: "2026-10-19T11:05:00.000Z",
}
const replaced: EFacturaSubmission = {
  ...base, id: "sub-1", environment: "test", state: "unknown", archiveState: "none", uploadIndex: null,
  errors: ["întrerupt"], superseded: true, createdAt: "2026-10-19T10:00:00.000Z",
}
const history: EFacturaHistory = {
  current: base, submissions: [base, replaced], resubmissions: [{ previousId: "sub-1", nextId: "sub-2", createdAt: "2026-10-19T11:00:00.000Z" }],
}

void test("each submission is a row: its moment, state, index and ANAF's messages", () => {
  const [current, old] = historyRows(history)
  assert.deepEqual([current?.title, current?.stateLine, current?.uploadIndex], ["Trimiterea din 19.10.2026, 14:00", "Stare: Acceptată", "5002"])
  assert.deepEqual([old?.stateLine, old?.uploadIndex, old?.errors], ["Stare: Necunoscut · ANAF TEST", undefined, ["întrerupt"]])
})

void test("a resubmission links both ways, to the row's own anchor", () => {
  const [current, old] = historyRows(history)
  assert.deepEqual(old?.replacedBy, { href: "#efactura-submission-sub-2", label: "Înlocuită de trimiterea din 19.10.2026, 14:00" })
  assert.deepEqual(current?.replaces, { href: "#efactura-submission-sub-1", label: "Înlocuiește trimiterea din 19.10.2026, 13:00" })
  assert.equal(current.anchorId, "efactura-submission-sub-2")
  assert.equal(current.replacedBy, undefined)
})

void test("the current submission's files are offered above, so only earlier rows carry buttons, each with its own name", () => {
  const rows = historyRows(history)
  assert.deepEqual(rows.map((row) => row.files), [false, true])
  assert.equal(rows[1]?.xmlLabel, "Descarcă XML trimis, trimiterea din 19.10.2026, 13:00")
  assert.equal(rows[1].responseLabel, undefined, "no ZIP before it is stored")
  assert.equal(rows[0]?.responseLabel, "Descarcă răspunsul ANAF, trimiterea din 19.10.2026, 14:00")
  assert.equal(new Set(rows.map((row) => row.xmlLabel)).size, rows.length)
})

void test("a queued submission's wait codes read as sentences; ANAF's own messages stay as written", () => {
  const queued: EFacturaSubmission = { ...base, state: "queued", uploadIndex: null, archiveState: "none", errors: ["neconectat", "conexiune_alt_cif"] }
  const [row] = historyRows({ current: queued, submissions: [queued], resubmissions: [] })
  assert.deepEqual(row?.errors, [
    "Trimiterea așteaptă: aplicația nu are o conexiune ANAF utilizabilă. Reconectează-te din Integrări.",
    "Trimiterea așteaptă: conexiunea ANAF este verificată pentru alt CIF decât cel de pe document.",
  ])
  const rejected: EFacturaSubmission = { ...base, state: "rejected", errors: ["neconectat"] }
  assert.deepEqual(historyRows({ current: rejected, submissions: [rejected], resubmissions: [] })[0]?.errors, ["neconectat"])
})

void test("candidates: a linked index is named as taken, the rest offer „Leagă”, and paging is decided here", () => {
  const view = candidatesView({
    page: 2, pages: 3, from: "2026-10-19T10:00:00.000Z", to: "2026-10-20T10:00:00.000Z",
    candidates: [
      { uploadIndex: "5001", createdAt: "2026-10-19T10:01:00.000Z", type: "FACTURA TRIMISA", linked: false },
      { uploadIndex: "5002", createdAt: "2026-10-19T10:02:00.000Z", type: "ERORI FACTURA", linked: true },
    ],
  })
  assert.deepEqual(view.rows.map((row) => [row.linkLabel, row.linked]), [["Leagă indexul 5001", false], ["Indexul 5002 este deja legat", true]])
  assert.deepEqual([view.pageLabel, view.previous, view.next], ["Pagina 2 din 3", 1, 3])
  assert.equal(view.window, "Mesajele ANAF între 19.10.2026, 13:00 și 20.10.2026, 13:00.")
  const single = candidatesView({ page: 1, pages: 1, from: "2026-10-19T10:00:00.000Z", to: "2026-10-20T10:00:00.000Z", candidates: [] })
  assert.deepEqual([single.pageLabel, single.previous, single.next], [undefined, undefined, undefined])
})

void test("the confirmations say exactly what the user takes on", () => {
  assert.match(linkConfirm("5001"), /^Confirm că acest mesaj ANAF este factura mea \(indexul 5001\)\./u)
  assert.match(RESUBMIT_CONFIRM, /nu dovedește că nu a fost trimis/u)
  assert.match(RESUBMIT_CONFIRM, /duplicat/u)
})
