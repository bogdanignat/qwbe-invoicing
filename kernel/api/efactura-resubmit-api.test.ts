import assert from "node:assert/strict"
import test from "node:test"

import { conflict, count, resubmit, unknownSubmission, withRig } from "./efactura-reconciliation.test-support.ts"

/**
 * `POST /api/efactura/submissions/{id}/resubmit`: one new submission in place
 * of an unknown one, on confirmation, in one transaction; repeated or
 * concurrent requests answer the same new submission.
 */

const idOf = (reply: { readonly body: unknown }) => String((reply.body as Record<string, unknown>).id)

void test("concurrent resubmits make one new submission; the old one stays unknown, superseded, and the link shows",
  () => withRig("efr_resubmit", async (rig) => {
    await rig.connect()
    const { invoiceId, id } = await unknownSubmission(rig, "inv-1")
    for (const body of [{}, { confirmed: false }]) assert.equal((await resubmit(rig, id, body)).status, 400, JSON.stringify(body))
    assert.equal(await count(rig, "efactura_submissions"), 1, "nothing without the confirmation")

    const replies = await Promise.all([1, 2, 3, 4].map(() => resubmit(rig, id)))
    assert.deepEqual(replies.map((reply) => reply.status).sort(), [200, 200, 200, 202], JSON.stringify(replies.map((reply) => reply.body)))
    const [next] = replies.map(idOf)
    assert.deepEqual(new Set(replies.map(idOf)), new Set([next]), "every concurrent request answers the same new submission")
    assert.ok(next !== undefined && next !== id)
    const again = await resubmit(rig, id)
    assert.deepEqual([again.status, idOf(again)], [200, next], "a repeat after a lost answer gets the same one")

    assert.equal(await count(rig, "efactura_submissions"), 2)
    assert.deepEqual(await rig.sql("SELECT state, superseded FROM efactura_submissions WHERE id=$1", [id]), [{ state: "unknown", superseded: true }])
    assert.equal((await rig.row(next)).state, "queued")
    assert.equal(await rig.status("issued_invoices", invoiceId), "queued")
    const [hashes] = await rig.sql(`SELECT (SELECT xml_sha256 FROM efactura_submissions WHERE id=$1) AS old,
      (SELECT xml_sha256 FROM efactura_submissions WHERE id=$2) AS new`, [id, next])
    assert.equal(hashes?.new, hashes?.old, "the same frozen snapshot, the same XML")
    const [linked] = await rig.sql(`SELECT r.next_id, r.duplicate_risk_confirmed, r.actor_id=s.created_by AS same_actor
      FROM efactura_resubmissions r JOIN efactura_submissions s ON s.id=r.next_id WHERE r.previous_id=$1`, [id])
    assert.deepEqual(linked, { next_id: next, duplicate_risk_confirmed: true, same_actor: true })
    assert.deepEqual(await rig.audit(id), ["efactura_submission.queued", "efactura_submission.resubmitted"])
    assert.deepEqual(await rig.audit(next), ["efactura_submission.queued"])

    const submitted = await rig.submit(invoiceId)
    assert.deepEqual([submitted.status, idOf(submitted)], [200, next], "submit answers the new one")
    const history = (await rig.server.call("GET", `/api/invoices/${invoiceId}/efactura/submissions`)).body as {
      current: { id: string }; submissions: ReadonlyArray<{ id: string; superseded: boolean }>
      resubmissions: ReadonlyArray<{ previousId: string; nextId: string }>
    }
    assert.equal(history.current.id, next)
    assert.deepEqual(history.submissions.map((submission) => [submission.id, submission.superseded]), [[next, false], [id, true]])
    assert.deepEqual(history.resubmissions.map(({ nextId, previousId }) => [previousId, nextId]), [[id, next]])
  }))

void test("only an unknown submission is resubmitted: queued, processing and accepted are refused, and so is one without a connection",
  () => withRig("efr_resubmit_guards", async (rig) => {
    await rig.connect()
    const queued = await rig.submitted(await rig.invoice("inv-1"))
    conflict(await resubmit(rig, queued), "efactura_not_unknown")
    const processing = await rig.submitted(await rig.invoice("inv-2"))
    await rig.sql("UPDATE efactura_submissions SET state='processing', upload_index='5000000001' WHERE id=$1", [processing])
    conflict(await resubmit(rig, processing), "efactura_not_unknown")
    await rig.sql(`UPDATE efactura_submissions SET state='accepted', download_id='3000000001', archive_state='pending' WHERE id=$1`, [processing])
    conflict(await resubmit(rig, processing), "efactura_not_unknown")
    assert.equal((await resubmit(rig, "missing")).status, 404)
    const { id } = await unknownSubmission(rig, "inv-3")
    await rig.connect({ cif: "18547290" })
    conflict(await resubmit(rig, id), "efactura_cif_mismatch")
    await rig.sql("DELETE FROM efactura_connections WHERE organization_id='org-1'")
    conflict(await resubmit(rig, id), "efactura_not_connected")
    assert.equal(await count(rig, "efactura_submissions"), 3, "no refusal writes a submission")
    assert.equal(await count(rig, "efactura_resubmissions"), 0)
    assert.deepEqual(await rig.sql("SELECT superseded FROM efactura_submissions WHERE id=$1", [id]), [{ superseded: false }])
  }))
