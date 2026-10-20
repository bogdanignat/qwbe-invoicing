import assert from "node:assert/strict"
import test from "node:test"

import { MAX_LINK_PAGES } from "../../cubes/invoicing/efactura/reconciliation/index.ts"
import { cutAfter, type DispatchRig } from "../efactura/dispatch/dispatch.test-support.ts"
import { candidates, conflict, count, link, listCalls, resubmit, withRig } from "./efactura-reconciliation.test-support.ts"

/**
 * Link across ANAF's pages, and a link racing a resubmit of the same unknown
 * submission. The unknown upload is one ANAF took and never answered, so the
 * fake lists it.
 */

/** An upload ANAF took without answering: `unknown` here, listed there. The dispatcher is stopped afterwards. */
const lostUpload = async (rig: DispatchRig, key: string) => {
  const dispatcher = rig.dispatcher(cutAfter(rig.fake.transport, 1_500))
  rig.fake.answer("upload", "timeout_after_send")
  const invoiceId = await rig.invoice(key)
  const id = await rig.submitted(invoiceId)
  await rig.reaches(id, "unknown")
  await dispatcher.stop()
  rig.fake.answer("upload", "normal")
  return { invoiceId, id }
}

const pagesAsked = (rig: DispatchRig, from: number) => listCalls(rig).slice(from).map((call) => call.pagina)

void test("an index on ANAF's second page is found and linked; one absent from more than 10 pages is refused after 10",
  () => withRig("efr_link_pages", async (rig) => {
    await rig.connect()
    const first = await lostUpload(rig, "inv-1")
    const second = await lostUpload(rig, "inv-2")
    assert.deepEqual([(await rig.row(first.id)).upload_index, rig.calls("upload")], [null, 2], "ANAF lists 5000000001 and 5000000002")
    rig.fake.paginate(1)

    const pageTwo = await candidates(rig, second.id, 2)
    assert.deepEqual([pageTwo.status, (pageTwo.body as { pages: number }).pages], [200, 2])
    let from = listCalls(rig).length
    const linked = await link(rig, second.id, { uploadIndex: "5000000002", confirmed: true })
    assert.equal(linked.status, 200, JSON.stringify(linked.body))
    assert.deepEqual(pagesAsked(rig, from), ["1", "2"], "page 1 did not have it, page 2 did")
    const row = await rig.row(second.id)
    assert.deepEqual([row.state, row.upload_index], ["processing", "5000000002"])

    rig.fake.paginate(1, MAX_LINK_PAGES + 2)
    from = listCalls(rig).length
    conflict(await link(rig, first.id, { uploadIndex: "5000000999", confirmed: true }), "efactura_index_not_listed")
    assert.deepEqual(pagesAsked(rig, from), Array.from({ length: MAX_LINK_PAGES }, (_, index) => String(index + 1)),
      "the first 10 of ANAF's 12 pages, each asked once, then refused")
    assert.equal((await rig.row(first.id)).state, "unknown")
    assert.equal(await count(rig, "efactura_submission_attempts WHERE submission_id=$1 AND operation='listaMesaje'", [first.id]),
      MAX_LINK_PAGES, "every page asked is in the call log")
  }))

/**
 * A link and a resubmit of the same unknown submission at once. With ANAF's list
 * answering at once either may win; with it slow, the resubmit commits while the
 * link waits on ANAF, and the link's own transaction then finds it superseded.
 */
const race = (label: string, listDelayMs: number, expected?: "link" | "resubmit") => withRig(label, async (rig) => {
  await rig.connect()
  const { invoiceId, id } = await lostUpload(rig, "inv-1")
  rig.fake.delay("lista", listDelayMs)
  const [linked, resubmitted] = await Promise.all([link(rig, id, { uploadIndex: "5000000001", confirmed: true }), resubmit(rig, id)])
  const replies = JSON.stringify([linked, resubmitted].map((reply) => [reply.status, reply.body]))
  const winner = linked.status === 200 ? "link" : "resubmit"
  if (expected !== undefined) assert.equal(winner, expected, replies)
  conflict(winner === "link" ? resubmitted : linked, "efactura_not_unknown")

  const old = await rig.sql("SELECT state, superseded, upload_index FROM efactura_submissions WHERE id=$1", [id])
  if (winner === "link") {
    assert.deepEqual(old, [{ state: "processing", superseded: false, upload_index: "5000000001" }])
    assert.equal(await count(rig, "efactura_submissions"), 1)
    assert.equal(await count(rig, "efactura_resubmissions"), 0)
    assert.equal(await rig.status("issued_invoices", invoiceId), "processing")
  } else {
    assert.equal(resubmitted.status, 202, replies)
    assert.deepEqual(old, [{ state: "unknown", superseded: true, upload_index: null }])
    const next = String((resubmitted.body as Record<string, unknown>).id)
    assert.equal((await rig.row(next)).state, "queued")
    assert.equal(await count(rig, "efactura_resubmissions WHERE previous_id=$1 AND next_id=$2", [id, next]), 1)
    assert.equal(await rig.status("issued_invoices", invoiceId), "queued")
  }
  assert.equal(await count(rig, "audit_events WHERE action IN ('efactura_submission.linked','efactura_submission.resubmitted')"), 1,
    "only the winner is audited")
})

void test("a link and a resubmit at once: exactly one wins, the other is refused, and the end state is coherent",
  () => race("efr_race_quick", 0))

void test("a resubmit that commits while the link waits on ANAF's list wins; the link is refused",
  () => race("efr_race_slow_list", 500, "resubmit"))
