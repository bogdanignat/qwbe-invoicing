import assert from "node:assert/strict"
import test from "node:test"

import { DOWNLOAD_RETRY_MS, listableFrom } from "../../../cubes/invoicing/efactura/received/index.ts"
import { FAKE_RETRY_AFTER } from "../anaf/fake-anaf.test-support.ts"
import { ORG } from "../anaf/connection.test-support.ts"
import { withMigrated } from "../../storage/postgres-rig.test-support.ts"
import { receivedRig, receivedZip, type ReceivedRig } from "./received.test-support.ts"

/**
 * What stops or holds a fetch of received invoices: a download ANAF keeps
 * refusing, a refused token, a throttle, a connection that is gone or for
 * another CIF, and a coverage too old to catch up. The list's own are in `received-listing.test.ts`.
 */
const withRig = (label: string, use: (rig: ReceivedRig) => Promise<void>) => withMigrated(label, async (fixture) => {
  const rig = await receivedRig(fixture)
  try { await use(rig) } finally { await rig.close() }
})

const conflictCode = (failure: unknown): unknown => (failure as { readonly code?: unknown }).code

void test("a download ANAF keeps refusing is tried three times, the fetch completes without it and the coverage stays; "
  + "the next fetch takes it over", () => withRig("efr_retry", async (rig) => {
  await rig.connect()
  rig.fake.receive([{ id: "4000000001", zip: receivedZip("R-1") }])
  rig.fake.answer("descarcare", "error_in_200")
  const { fetch } = await rig.request()
  rig.dispatcher()
  await rig.until("first attempt", async () => (await rig.messages())[0]?.attempts === 1)
  assert.equal((await rig.fetchRow(fetch.id)).state, "downloading", "it waits for the retry")
  for (const attempts of [2, 3]) {
    rig.clock.offsetMs += DOWNLOAD_RETRY_MS + 1000
    await rig.until(`attempt ${String(attempts)}`, async () => (await rig.messages())[0]?.attempts === attempts)
  }
  const done = await rig.ends(fetch)
  assert.deepEqual([done.downloaded, done.failed], [0, 1])
  assert.deepEqual((await rig.messages()).map(({ state }) => state), ["download_failed"])
  assert.equal(await rig.coveredUntil(), undefined, "a message given up holds the coverage back")
  assert.equal(rig.calls("descarcare"), 3)

  rig.fake.answer("descarcare", "normal")
  const next = (await rig.request()).fetch
  assert.equal(next.window.start, new Date(listableFrom(new Date(next.createdAt))).toISOString(), "without coverage it lists all ANAF still lists")
  const again = await rig.ends(next)
  assert.deepEqual([again.queued, again.downloaded, again.failed], [1, 1, 0])
  assert.deepEqual((await rig.messages()).map(({ state, fetch_id }) => [state, fetch_id]), [["stored", next.id]])
  assert.equal(await rig.coveredUntil(), again.window_end)
}))

void test("a 401 asks for one refresh, the next call goes out with the new pair, and a second refusal fails the fetch", () =>
  withRig("efr_401", async (rig) => {
    await rig.connect()
    rig.fake.answer("lista", "unauthorized")
    const { fetch } = await rig.request()
    rig.dispatcher()
    const done = await rig.ends(fetch, "failed")
    assert.deepEqual(done.errors, ["token_refuzat"])
    assert.equal(rig.calls("token"), 1, "one refresh, never a loop")
    assert.deepEqual(rig.listCalls().map(({ authorization }) => authorization), ["Bearer access-0", "Bearer access-1"])
  }))

void test("a 429 pauses the organization and the fetch until Retry-After, then it goes on", () => withRig("efr_429", async (rig) => {
  await rig.connect()
  rig.fake.answer("lista", "rate_limited")
  const { fetch } = await rig.request()
  rig.dispatcher()
  await rig.until("the pause", async () => (await rig.sql("SELECT paused_until FROM efactura_rate_limits WHERE organization_id=$1 AND paused_until>$2",
    [ORG, rig.now().toISOString()])).length === 1)
  const [paused] = await rig.sql("SELECT f.next_attempt_at, r.paused_until FROM efactura_received_fetches f, efactura_rate_limits r WHERE f.id=$1",
    [fetch.id])
  assert.equal(paused?.next_attempt_at, paused?.paused_until)
  assert.ok(Date.parse(String(paused?.paused_until)) - rig.now().getTime() > (Number(FAKE_RETRY_AFTER) - 2) * 1000)
  assert.equal((await rig.fetchRow(fetch.id)).state, "listing")
  rig.fake.answer("lista", "normal")
  rig.clock.offsetMs += Number(FAKE_RETRY_AFTER) * 1000 + 1000
  assert.equal((await rig.ends(fetch)).pages_listed, 1)
  assert.equal(rig.listCalls().length, 2)
}))

void test("a fetch is refused without ANAF configured, without a connection or with one for another CIF", () => withRig("efr_refused", async (rig) => {
  assert.equal(conflictCode(await rig.refusal({ configured: false })), "efactura_not_configured")
  assert.equal(conflictCode(await rig.refusal()), "efactura_not_connected")
  await rig.connect({ cif: "11111110" })
  assert.equal(conflictCode(await rig.refusal()), "efactura_cif_mismatch")
  assert.equal((await rig.refusal({ permissions: [] }))._tag, "PermissionDenied")
  assert.equal((await rig.sql("SELECT count(*)::int AS n FROM efactura_received_fetches"))[0]?.n, 0)
}))

void test("a fetch whose connection moved to another CIF fails without calling ANAF", () => withRig("efr_moved", async (rig) => {
  await rig.connect()
  const { fetch } = await rig.request()
  await rig.connect({ cif: "11111110", generation: 2 })
  rig.dispatcher()
  assert.deepEqual((await rig.ends(fetch, "failed")).errors, ["conexiune_alt_cif"])
  assert.equal(rig.listCalls().length, 0)
}))

void test("a coverage older than 60 days: the new fetch starts where ANAF still lists and keeps the gap it cannot reach", () =>
  withRig("efr_gap", async (rig) => {
    await rig.connect()
    const old = (await rig.request()).fetch
    const coveredUntil = new Date(rig.now().getTime() - 70 * 86_400_000).toISOString()
    await rig.sql("UPDATE efactura_received_fetches SET state='completed' WHERE id=$1", [old.id])
    await rig.sql("INSERT INTO efactura_received_coverage(organization_id,environment,covered_until,fetch_id,updated_at) VALUES($1,'test',$2,$3,$2)",
      [ORG, coveredUntil, old.id])
    const { fetch } = await rig.request()
    assert.deepEqual(fetch.window.gap, { from: coveredUntil, until: fetch.window.start })
    const row = await rig.fetchRow(fetch.id)
    assert.deepEqual([row.gap_start, row.gap_end, row.window_start], [coveredUntil, fetch.window.start, fetch.window.start])
  }))
