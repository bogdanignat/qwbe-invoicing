import assert from "node:assert/strict"
import test from "node:test"

import { cutAfter } from "../efactura/dispatch/dispatch.test-support.ts"
import { candidates, conflict, link, listCalls, withRig } from "./efactura-reconciliation.test-support.ts"

/**
 * `POST /api/efactura/submissions/{id}/link`: an upload whose answer was lost
 * (ANAF took it, the fake lists it) is linked to the index ANAF lists, only
 * on confirmation and only after the server found it in ANAF's own list.
 */

void test("an index ANAF lists links the unknown submission, and the dispatcher's polling takes it to accepted",
  () => withRig("efr_link", async (rig) => {
    await rig.connect()
    rig.dispatcher(cutAfter(rig.fake.transport, 1_500))
    rig.fake.answer("upload", "timeout_after_send")
    const invoiceId = await rig.invoice("inv-1")
    const id = await rig.submitted(invoiceId)
    await rig.reaches(id, "unknown")
    rig.fake.answer("upload", "normal")
    const other = await rig.submitted(await rig.invoice("inv-2"))
    await rig.reaches(other, "processing")
    assert.equal((await rig.row(other)).upload_index, "5000000002")

    const listed = await candidates(rig, id)
    assert.deepEqual((listed.body as { candidates: ReadonlyArray<{ uploadIndex: string; type: string; linked: boolean }> }).candidates
      .map(({ linked, type, uploadIndex }) => [uploadIndex, type, linked]),
    [["5000000001", "FACTURA TRIMISA", false], ["5000000002", "FACTURA TRIMISA", true]], "an index another submission holds is marked")
    assert.equal(listCalls(rig).length, 1, "marking linked indexes reads local data only")

    for (const body of [{ uploadIndex: "5000000001" }, { uploadIndex: "5000000001", confirmed: false }, { uploadIndex: "50-1", confirmed: true }]) {
      assert.equal((await link(rig, id, body)).status, 400, JSON.stringify(body))
    }
    const asked = listCalls(rig).length
    assert.equal(asked, 1, "a refused body never reaches ANAF")
    conflict(await link(rig, id, { uploadIndex: "5000000999", confirmed: true }), "efactura_index_not_listed")
    assert.equal(listCalls(rig).length, asked + 1, "the server asked ANAF itself")
    conflict(await link(rig, id, { uploadIndex: "5000000002", confirmed: true }), "efactura_index_linked")
    conflict(await link(rig, other, { uploadIndex: "5000000001", confirmed: true }), "efactura_not_unknown")
    assert.equal((await rig.row(id)).state, "unknown", "every refusal leaves it as it was")

    const linked = await link(rig, id, { uploadIndex: "5000000001", confirmed: true })
    assert.equal(linked.status, 200, JSON.stringify(linked.body))
    assert.deepEqual([(linked.body as Record<string, unknown>).state, (linked.body as Record<string, unknown>).uploadIndex],
      ["processing", "5000000001"])
    assert.equal(await rig.status("issued_invoices", invoiceId), "processing")
    const [audit] = await rig.sql(`SELECT a.actor_id, a.reason, s.created_by FROM audit_events a JOIN efactura_submissions s ON s.id=a.target_id
      WHERE a.action='efactura_submission.linked' AND a.target_id=$1`, [id])
    assert.equal(audit?.reason, "upload_index:5000000001")
    assert.equal(audit.actor_id, audit.created_by, "the user who linked it")
    await rig.reaches(id, "accepted", "stored")
    assert.ok(rig.fake.calls.some((call) => call.operation === "stareMesaj" && call.path.endsWith("id_incarcare=5000000001")))
    assert.equal(await rig.status("issued_invoices", invoiceId), "accepted")
    conflict(await link(rig, id, { uploadIndex: "5000000001", confirmed: true }), "efactura_not_unknown")
    assert.equal(rig.calls("upload"), 2, "linking never uploads")
  }))
