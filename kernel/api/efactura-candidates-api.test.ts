import assert from "node:assert/strict"
import test from "node:test"

import { ISSUER_CIF } from "../efactura/anaf/connection.test-support.ts"
import { candidates, conflict, count, link, listCalls, resubmit, unknownSubmission, withRig } from "./efactura-reconciliation.test-support.ts"

/**
 * `GET /api/efactura/submissions/{id}/candidates`: what ANAF lists for an
 * unknown submission's CIF and window, through the real server. Every call is
 * reserved in the organization's budget first; a request never refreshes a token.
 */

void test("candidates ask ANAF for the submission's CIF from its creation, reserve the budget and log the call",
  () => withRig("efr_candidates", async (rig) => {
    await rig.connect()
    const { id } = await unknownSubmission(rig, "inv-1")
    const reply = await candidates(rig, id)
    assert.equal(reply.status, 200, JSON.stringify(reply.body))
    assert.deepEqual((reply.body as Record<string, unknown>).candidates, [])
    assert.deepEqual([(reply.body as Record<string, unknown>).page, (reply.body as Record<string, unknown>).pages], [1, 1])
    const createdAt = String((await rig.sql("SELECT created_at FROM efactura_submissions WHERE id=$1", [id]))[0]?.created_at)
    const [asked] = listCalls(rig)
    assert.equal(asked?.cif, ISSUER_CIF)
    assert.equal(asked.startTime, String(Date.parse(createdAt)))
    assert.ok(Number(asked.endTime) >= Number(asked.startTime) && Number(asked.endTime) <= Date.now())
    assert.equal(asked.pagina, "1")
    assert.equal((reply.body as Record<string, unknown>).from, createdAt)
    assert.equal((await rig.sql("SELECT used FROM efactura_rate_limits WHERE organization_id='org-1'"))[0]?.used, 1, "reserved")
    assert.deepEqual(await rig.attempts(id), ["listaMesaje:answered"])
    assert.equal((await candidates(rig, id, 2)).status, 200, "a later page is asked as such")
    assert.equal(listCalls(rig)[1]?.pagina, "2")
  }))

void test("candidates only for a current unknown submission, connected for its CIF; nothing leaves otherwise",
  () => withRig("efr_candidates_guards", async (rig) => {
    await rig.connect()
    const queued = await rig.submitted(await rig.invoice("inv-1"))
    conflict(await candidates(rig, queued), "efactura_not_unknown")
    const { id } = await unknownSubmission(rig, "inv-2")
    await resubmit(rig, id)
    conflict(await candidates(rig, id), "efactura_not_unknown")
    const { id: other } = await unknownSubmission(rig, "inv-3")
    assert.equal((await candidates(rig, "missing")).status, 404)
    await rig.connect({ cif: "18547290" })
    conflict(await candidates(rig, other), "efactura_cif_mismatch")
    await rig.sql("DELETE FROM efactura_connections WHERE organization_id='org-1'")
    conflict(await candidates(rig, other), "efactura_not_connected")
    assert.equal(listCalls(rig).length, 0, "no list call at all")
  }))

void test("a 401 asks the dispatcher for one refresh and answers 409; the request itself never refreshes",
  () => withRig("efr_candidates_refresh", async (rig) => {
    await rig.connect()
    const { id } = await unknownSubmission(rig, "inv-1")
    rig.fake.answer("lista", "unauthorized")
    conflict(await candidates(rig, id), "efactura_connection_refreshing")
    assert.equal(rig.calls("token"), 0, "no refresh from the request")
    assert.deepEqual(await rig.sql("SELECT refresh_requested FROM efactura_connections"), [{ refresh_requested: true }])
    assert.deepEqual(await rig.attempts(id), ["listaMesaje:auth_refused"])
    rig.fake.answer("lista", "normal")
    rig.dispatcher()
    await rig.until("the dispatcher refreshes", async () => rig.calls("token") === 1
      && (await rig.sql("SELECT refresh_requested FROM efactura_connections"))[0]?.refresh_requested === false)
    assert.equal((await candidates(rig, id)).status, 200)
    assert.equal(listCalls(rig).at(-1)?.authorization, "Bearer access-1", "the next call uses the refreshed pair")
    assert.equal(rig.calls("token"), 1)
  }))

void test("a spent budget or ANAF's 429 refuses with 409, and a pause holds every later call back",
  () => withRig("efr_candidates_budget", async (rig) => {
    await rig.connect()
    const { id } = await unknownSubmission(rig, "inv-1")
    rig.fake.answer("lista", "rate_limited")
    conflict(await candidates(rig, id), "efactura_rate_limited")
    const [paused] = await rig.sql("SELECT paused_until FROM efactura_rate_limits WHERE organization_id='org-1'")
    assert.ok(Date.parse(String(paused?.paused_until)) > Date.now(), "the organization is paused")
    rig.fake.answer("lista", "normal")
    conflict(await candidates(rig, id), "efactura_rate_limited")
    conflict(await link(rig, id, { uploadIndex: "5000000001", confirmed: true }), "efactura_rate_limited")
    assert.equal(listCalls(rig).length, 1, "nothing leaves while paused")
    assert.equal(await count(rig, "efactura_submission_attempts WHERE submission_id=$1", [id]), 1)
    await rig.sql("UPDATE efactura_rate_limits SET paused_until='1970-01-01T00:00:00.000Z'")
    rig.fake.answer("lista", "error_in_200")
    conflict(await candidates(rig, id), "efactura_no_right")
  }))

void test("without efactura:reconcile every reconciliation route is 403 and nothing is written or asked",
  () => withRig("efr_forbidden", async (rig) => {
    await rig.connect()
    const { id } = await unknownSubmission(rig, "inv-1")
    for (const reply of [await candidates(rig, id), await link(rig, id, { uploadIndex: "5000000001", confirmed: true }), await resubmit(rig, id)]) {
      assert.deepEqual([reply.status, (reply.body as Record<string, unknown>).error], [403, "PermissionDenied"])
    }
    assert.equal(listCalls(rig).length, 0)
    assert.equal(await count(rig, "efactura_submissions"), 1)
    assert.equal((await rig.row(id)).state, "unknown")
  }, (permissions) => permissions.filter((permission) => permission !== "efactura:reconcile")))
