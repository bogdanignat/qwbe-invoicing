import assert from "node:assert/strict"
import test from "node:test"

import { gated } from "../anaf/connection.test-support.ts"
import { FAKE_ZIP, type FakeScenario } from "../anaf/fake-anaf.test-support.ts"
import { bucharestDay, nextBucharestMidnight } from "../../../cubes/invoicing/efactura/submissions/index.ts"
import { withMigrated } from "../../storage/postgres-rig.test-support.ts"
import { cutAfter, dispatchRig, type DispatchRig } from "./dispatch.test-support.ts"
import { OTHER_CIF } from "./dispatch-step.ts"

/**
 * The dispatcher against a real database and the fake ANAF: every state a
 * submission can reach on its own, the call log, the document's projection and
 * the audit trail. Nothing here reaches ANAF.
 */

const withRig = (label: string, use: (rig: DispatchRig) => Promise<void>) => withMigrated(label, async (fixture) => {
  const rig = await dispatchRig(fixture)
  try { await use(rig) } finally { await rig.close() }
})

const queued = async (rig: DispatchRig, key: string) => {
  const invoiceId = await rig.invoice(key)
  return { invoiceId, id: await rig.submitted(invoiceId) }
}

void test("a queued invoice is validated, uploaded, polled, accepted, and ANAF's ZIP is stored", () => withRig("efd_accepted", async (rig) => {
  await rig.connect()
  const { invoiceId, id } = await queued(rig, "inv-1")
  assert.equal(await rig.status("issued_invoices", invoiceId), "queued")
  rig.dispatcher()
  await rig.reaches(id, "processing")
  assert.equal(await rig.status("issued_invoices", invoiceId), "processing")
  assert.equal(rig.calls("stareMesaj"), 0, "the first poll waits a minute")
  rig.clock.offsetMs += 61_000
  await rig.reaches(id, "accepted", "stored")
  assert.equal(await rig.status("issued_invoices", invoiceId), "accepted")
  assert.deepEqual(["validare", "upload", "stareMesaj", "descarcare"].map(rig.calls), [1, 1, 1, 1])
  const upload = rig.fake.calls.find((call) => call.operation === "upload")
  assert.equal(upload?.path, "/test/FCTEL/rest/upload?standard=UBL&cif=12345674")
  assert.equal(upload.authorization, "Bearer access-0")
  const xml = await rig.server.call("GET", `/api/efactura/submissions/${id}/xml`)
  assert.equal(xml.status, 200)
  assert.equal(String(xml.body), upload.body.toString("utf8"), "the exact stored XML is what was uploaded")
  const zip = await fetch(`${rig.server.origin}/api/efactura/submissions/${id}/response`, { headers: { cookie: rig.server.cookie } })
  assert.equal(zip.headers.get("content-type"), "application/zip")
  assert.deepEqual(Buffer.from(await zip.arrayBuffer()), FAKE_ZIP)
  assert.deepEqual(await rig.audit(id), ["efactura_submission.queued", "efactura_submission.accepted"])
  assert.deepEqual(await rig.attempts(id), ["validare:answered", "upload:answered", "stareMesaj:answered", "descarcare:answered"])
  const history = await rig.server.call("GET", `/api/invoices/${invoiceId}/efactura/submissions`)
  const body = history.body as { current: Record<string, unknown>; submissions: ReadonlyArray<unknown> }
  assert.deepEqual([body.current.state, body.current.archiveState, body.submissions.length], ["accepted", "stored", 1])
  assert.equal(body.current.organizationId, undefined, "the organization never leaves")
}))

void test("ANAF's nok ends rejected, with its ZIP stored; a refusal at validation never uploads", () => withRig("efd_rejected", async (rig) => {
  await rig.connect()
  rig.fake.answer("stareMesaj", "rejected")
  const rejected = await queued(rig, "inv-1")
  rig.dispatcher()
  await rig.reaches(rejected.id, "processing")
  rig.clock.offsetMs += 61_000
  await rig.reaches(rejected.id, "rejected", "stored")
  assert.equal((await rig.row(rejected.id)).download_id, "3000000999")
  assert.equal(await rig.status("issued_invoices", rejected.invoiceId), "rejected")
  assert.deepEqual(await rig.audit(rejected.id), ["efactura_submission.queued", "efactura_submission.rejected"])

  rig.fake.answer("validare", "error_in_200")
  const refused = await queued(rig, "inv-2")
  await rig.reaches(refused.id, "refused")
  assert.match((await rig.row(refused.id)).errors, /BR-RO-010/u)
  assert.equal(rig.calls("upload"), 1, "only the first submission was uploaded")
  assert.equal(await rig.status("issued_invoices", refused.invoiceId), "refused")
  assert.deepEqual(await rig.attempts(refused.id), ["validare:anaf_error"])
  assert.deepEqual(await rig.audit(refused.id), ["efactura_submission.queued", "efactura_submission.refused"])
}))

void test("an upload ANAF refuses with errors and no index is refused", () => withRig("efd_upload_refused", async (rig) => {
  await rig.connect()
  rig.fake.answer("upload", "error_in_200")
  const { id } = await queued(rig, "inv-1")
  rig.dispatcher()
  await rig.reaches(id, "refused")
  const refused = await rig.row(id)
  assert.equal(refused.upload_index, null)
  assert.deepEqual(JSON.parse(refused.errors), ["Fisierul transmis nu este valid."])
  assert.deepEqual(await rig.attempts(id), ["validare:answered", "upload:anaf_error"])
}))

void test("an upload without a clear answer is unknown and is never sent again", () => withRig("efd_upload_unknown", async (rig) => {
  await rig.connect()
  rig.dispatcher(cutAfter(rig.fake.transport, 1_500))
  const cases: ReadonlyArray<readonly [FakeScenario, string]> = [
    ["timeout_after_send", "upload:ambiguous"], ["server_error", "upload:unrecognized"], ["redirect", "upload:ambiguous"],
    ["malformed", "upload:unrecognized"], ["rate_limited", "upload:rate_limited"],
  ]
  for (const [index, [scenario, logged]] of cases.entries()) {
    rig.fake.answer("upload", scenario)
    const { invoiceId, id } = await queued(rig, `inv-${String(index)}`)
    await rig.reaches(id, "unknown")
    assert.equal(rig.calls("upload"), index + 1, `${scenario}: one POST`)
    assert.deepEqual(await rig.attempts(id), ["validare:answered", logged], scenario)
    assert.equal(await rig.status("issued_invoices", invoiceId), "unknown")
    assert.deepEqual(await rig.audit(id), ["efactura_submission.queued", "efactura_submission.unknown"])
  }
  rig.fake.answer("upload", "normal")
  rig.clock.offsetMs += 3 * 3_600_000
  await new Promise((resolve) => { setTimeout(resolve, 500) })
  assert.equal(rig.calls("upload"), cases.length, "nothing unknown is ever uploaded again")
}))

void test("a 401 on upload refreshes once, goes back to the queue and uploads once more; a refused fresh pair is not refreshed again",
  () => withRig("efd_upload_401", async (rig) => {
    await rig.connect()
    const token = gated(rig.fake.transport, "/token")
    const refresh = token.hold()
    rig.fake.answer("upload", "unauthorized")
    const first = await queued(rig, "inv-1")
    rig.dispatcher(token.transport)
    await refresh.reached
    assert.equal((await rig.row(first.id)).state, "queued", "an explicit 401 was not taken: back to the queue before the refresh")
    rig.fake.answer("upload", "normal")
    refresh.release()
    await rig.reaches(first.id, "processing")
    assert.deepEqual(await rig.attempts(first.id), ["validare:answered", "upload:auth_refused", "validare:answered", "upload:answered"])
    assert.deepEqual(rig.fake.calls.filter((call) => call.operation === "upload").map((call) => call.authorization),
      ["Bearer access-0", "Bearer access-1"])

    rig.fake.answer("upload", "unauthorized")
    const second = await queued(rig, "inv-2")
    await rig.until("the second 401", async () => (await rig.attempts(second.id)).includes("upload:auth_refused"))
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    assert.equal(rig.calls("token"), 1, "the pair a refusal produced is not refreshed on the next refusal")
    const waiting = await rig.row(second.id)
    assert.equal(waiting.state, "queued")
    assert.ok(Date.parse(waiting.next_attempt_at) > rig.now().getTime(), "it waits instead of looping")
  }))

void test("a 401 at validation refreshes once, goes back to the queue and validates again with the fresh pair",
  () => withRig("efd_validate_401", async (rig) => {
    await rig.connect()
    const token = gated(rig.fake.transport, "/token")
    const refresh = token.hold()
    rig.fake.answer("validare", "unauthorized")
    const { id } = await queued(rig, "inv-1")
    rig.dispatcher(token.transport)
    await refresh.reached
    assert.equal((await rig.row(id)).state, "queued", "an explicit 401 at validation: back to the queue, nothing uploaded")
    assert.equal(rig.calls("upload"), 0)
    rig.fake.answer("validare", "normal")
    refresh.release()
    await rig.reaches(id, "processing")
    assert.deepEqual(await rig.attempts(id), ["validare:auth_refused", "validare:answered", "upload:answered"])
    assert.deepEqual(rig.fake.calls.filter((call) => call.operation === "validare").map((call) => call.authorization),
      ["Bearer access-0", "Bearer access-1"])
    assert.equal(rig.calls("token"), 1)
  }))

void test("a connection made again for another CIF sends nothing: the submission waits queued, and says why",
  () => withRig("efd_other_cif", async (rig) => {
    await rig.connect()
    const { invoiceId, id } = await queued(rig, "inv-1")
    await rig.connect({ cif: "18547290" })
    rig.dispatcher()
    await rig.until("the reason", async () => (await rig.row(id)).errors.includes(OTHER_CIF))
    await new Promise((resolve) => { setTimeout(resolve, 300) })
    assert.deepEqual(rig.fake.calls.map((call) => call.operation), [], "no validation, no upload, no refresh")
    const waiting = await rig.row(id)
    assert.equal(waiting.state, "queued", "ANAF refused nothing")
    assert.ok(Date.parse(waiting.next_attempt_at) > rig.now().getTime(), "it waits like a missing connection")
    assert.equal(await rig.status("issued_invoices", invoiceId), "queued")
    const history = (await rig.server.call("GET", `/api/invoices/${invoiceId}/efactura/submissions`)).body as
      { current: { state: string; errors: ReadonlyArray<string> } }
    assert.deepEqual([history.current.state, history.current.errors], ["queued", [OTHER_CIF]])

    await rig.connect()
    rig.clock.offsetMs += 16 * 60_000
    await rig.reaches(id, "processing")
    assert.deepEqual(JSON.parse((await rig.row(id)).errors), [], "the reason goes once it is sent")
    assert.equal(rig.calls("upload"), 1)
  }))

void test("an access token that expires within 7 days is refreshed before the calls", () => withRig("efd_proactive", async (rig) => {
  await rig.connect({ accessExpiresInDays: 3 })
  const { id } = await queued(rig, "inv-1")
  rig.dispatcher()
  await rig.reaches(id, "processing")
  assert.equal(rig.calls("token"), 1)
  assert.equal(rig.fake.calls.find((call) => call.operation === "validare")?.authorization, "Bearer access-1")
}))

void test("after a crash: uploading turns unknown, validating starts over, processing and pending archives resume",
  () => withRig("efd_recovery", async (rig) => {
    await rig.connect()
    const interrupted = await queued(rig, "inv-1")
    const validating = await queued(rig, "inv-2")
    await rig.sql("UPDATE efactura_submissions SET state='uploading' WHERE id=$1", [interrupted.id])
    await rig.sql("UPDATE efactura_submissions SET state='validating' WHERE id=$1", [validating.id])
    const first = rig.dispatcher()
    await rig.reaches(interrupted.id, "unknown")
    await rig.reaches(validating.id, "processing")
    assert.equal(rig.calls("upload"), 1, "the interrupted upload is never sent again")
    assert.deepEqual(await rig.audit(interrupted.id), ["efactura_submission.queued", "efactura_submission.unknown"])
    await first.stop()

    rig.clock.offsetMs += 61_000
    rig.dispatcher()
    await rig.reaches(validating.id, "accepted", "stored")
    assert.equal(rig.calls("upload"), 1)
  }))

void test("budgets: a spent day or minute holds the call back, a timed-out call still counts, a 429 pauses the organization",
  () => withRig("efd_budgets", async (rig) => {
    await rig.connect()
    // Five seconds into a minute of the dispatcher's clock, so the minute cannot roll over under the test.
    rig.clock.offsetMs += (65_000 - (rig.now().getTime() % 60_000)) % 60_000
    const minute = rig.now().toISOString().slice(0, 16)
    await rig.sql("INSERT INTO efactura_rate_limits(organization_id,minute,used,paused_until) VALUES('org-1',$1,900,$2)",
      [minute, "1970-01-01T00:00:00.000Z"])
    const held = await queued(rig, "inv-1")
    const first = rig.dispatcher(cutAfter(rig.fake.transport, 1_500))
    const nextMinute = new Date(Date.parse(`${minute}:00.000Z`) + 60_000).toISOString()
    await rig.until("the minute's wait", async () => (await rig.row(held.id)).next_attempt_at === nextMinute)
    assert.equal(rig.calls("validare"), 0, "a spent minute makes no call")
    rig.clock.offsetMs += 60_000
    await rig.reaches(held.id, "processing")
    await first.stop()

    const index = String((await rig.row(held.id)).upload_index)
    rig.clock.offsetMs += 61_000
    await rig.sql("INSERT INTO efactura_message_budgets(organization_id,operation,message_id,day,used) VALUES('org-1','stareMesaj',$1,$2,90)",
      [index, bucharestDay(rig.now())])
    const second = rig.dispatcher()
    const midnight = nextBucharestMidnight(rig.now()).toISOString()
    await rig.until("the day's wait", async () => (await rig.row(held.id)).next_attempt_at === midnight)
    assert.equal(rig.calls("stareMesaj"), 0, "90 polls of a message a day, then nothing until Bucharest's midnight")
    await second.stop()

    await rig.sql("UPDATE efactura_message_budgets SET used=1, day='2000-01-01' WHERE message_id=$1", [index])
    await rig.sql("UPDATE efactura_submissions SET next_attempt_at=$2 WHERE id=$1", [held.id, rig.now().toISOString()])
    rig.fake.answer("stareMesaj", "timeout_after_send")
    const third = rig.dispatcher(cutAfter(rig.fake.transport, 500))
    await rig.until("the timed-out poll", async () => (await rig.attempts(held.id)).includes("stareMesaj:ambiguous"))
    await third.stop()
    const [budget] = await rig.sql("SELECT used, day FROM efactura_message_budgets WHERE message_id=$1", [index])
    assert.deepEqual([budget?.used, budget?.day], [1, bucharestDay(rig.now())], "the call that timed out was reserved before it left")

    rig.fake.answer("stareMesaj", "rate_limited")
    await rig.sql("UPDATE efactura_submissions SET next_attempt_at=$2 WHERE id=$1", [held.id, rig.now().toISOString()])
    rig.dispatcher()
    await rig.until("the 429", async () => (await rig.attempts(held.id)).includes("stareMesaj:rate_limited"))
    await rig.until("the pause written", async () => (await rig.row(held.id)).next_attempt_at
      === String((await rig.sql("SELECT paused_until FROM efactura_rate_limits WHERE organization_id='org-1'"))[0]?.paused_until))
    const paused = Date.parse((await rig.row(held.id)).next_attempt_at)
    assert.ok(paused > rig.now().getTime() && paused <= rig.now().getTime() + 7_000, "Retry-After: 7 pauses the organization 7 s")
    assert.equal((await rig.row(held.id)).state, "processing")
  }))
