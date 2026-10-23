import assert from "node:assert/strict"
import test from "node:test"

import { LISTABLE_DAYS } from "../../../cubes/invoicing/efactura/received/index.ts"
import { FAKE_TOO_OLD } from "../anaf/fake-anaf.test-support.ts"
import { withMigrated } from "../../storage/postgres-rig.test-support.ts"
import { RETRY_WAIT_MS } from "./dispatch-calls.ts"
import { cutAfter } from "./dispatch.test-support.ts"
import { receivedRig, receivedZip, type ReceivedRig } from "./received.test-support.ts"

/**
 * How a fetch lists: the window its first page is asked for, a window that
 * falls out of ANAF's 60 days halfway, answers that say nothing clear, and
 * ANAF's refusals of the list.
 */
const withRig = (label: string, use: (rig: ReceivedRig) => Promise<void>) => withMigrated(label, async (fixture) => {
  const rig = await receivedRig(fixture)
  try { await use(rig) } finally { await rig.close() }
})

const HOUR_MS = 60 * 60_000

const asked = (rig: ReceivedRig, name: string) => rig.listCalls().map(({ path }) => Number(new URL(path, "https://x").searchParams.get(name)))

void test("a fetch asked an hour ago and not listed yet takes its window again from now, and keeps it with its first page", () =>
  withRig("efl_late", async (rig) => {
    await rig.connect()
    rig.fake.receive([{ id: "4000000001", zip: receivedZip("R-1") }])
    const { fetch } = await rig.request()
    rig.clock.offsetMs += HOUR_MS
    rig.dispatcher()
    const done = await rig.ends(fetch)
    assert.deepEqual([done.errors, done.downloaded], [[], 1], "listed, not failed as expired")
    const [start, end] = [Date.parse(String(done.window_start)), Date.parse(String(done.window_end))]
    assert.ok(start - Date.parse(fetch.window.start) >= HOUR_MS && end - Date.parse(fetch.window.end) >= HOUR_MS)
    assert.deepEqual([asked(rig, "startTime"), asked(rig, "endTime")], [[start], [end]], "the stored window is the one ANAF was asked")
    assert.deepEqual([done.gap_start, done.gap_end], [done.window_start, done.window_start])
    assert.equal(await rig.coveredUntil(), done.window_end)
  }))

void test("a window half listed that fell out of ANAF's 60 days fails the fetch instead of asking for the rest", () =>
  withRig("efl_expired", async (rig) => {
    await rig.connect()
    const { fetch } = await rig.request()
    const old = new Date(rig.now().getTime() - LISTABLE_DAYS * 86_400_000 - 60_000).toISOString()
    await rig.sql(`UPDATE efactura_received_fetches SET pages_listed=1,pages_total=2,window_start=$2,gap_start=$2,gap_end=$2 WHERE id=$1`,
      [fetch.id, old])
    rig.dispatcher()
    assert.deepEqual((await rig.ends(fetch, "failed")).errors, ["fereastra_expirata"])
    assert.equal(rig.listCalls().length, 0)
  }))

void test("list answers that say nothing clear, or nothing at all, are asked again five times, then the fetch fails as unavailable", () =>
  withRig("efl_unclear", async (rig) => {
    await rig.connect()
    rig.fake.answer("lista", "timeout_after_send")
    const { fetch } = await rig.request()
    rig.dispatcher(cutAfter(rig.fake.transport, 300))
    await rig.until("a first retry", async () => (await rig.fetchRow(fetch.id)).retries === 1)
    rig.fake.answer("lista", "server_error")
    for (const retries of [2, 3, 4, 5]) {
      rig.clock.offsetMs += RETRY_WAIT_MS + 1000
      await rig.until(`retry ${String(retries)}`, async () => (await rig.fetchRow(fetch.id)).retries === retries)
    }
    assert.equal((await rig.fetchRow(fetch.id)).state, "listing")
    rig.clock.offsetMs += RETRY_WAIT_MS + 1000
    assert.deepEqual((await rig.ends(fetch, "failed")).errors, ["anaf_indisponibil"])
    assert.equal(rig.listCalls().length, 6)
  }))

void test("a page listed after an unclear answer starts the count again; an empty window counts as its one page", () =>
  withRig("efl_reset", async (rig) => {
    await rig.connect()
    rig.fake.answer("lista", "server_error")
    const { fetch } = await rig.request()
    rig.dispatcher()
    await rig.until("a retry", async () => (await rig.fetchRow(fetch.id)).retries === 1)
    rig.fake.answer("lista", "normal")
    rig.clock.offsetMs += RETRY_WAIT_MS + 1000
    const done = await rig.ends(fetch)
    assert.deepEqual([done.retries, done.pages_listed, done.pages_total, done.found], [0, 1, 1, 0])
    assert.equal(await rig.coveredUntil(), done.window_end, "nothing received is a window covered all the same")
  }))

void test("ANAF's refusal of the list fails the fetch at once: no right on the CIF, or its own 60-day error", () =>
  withRig("efl_refused", async (rig) => {
    await rig.connect()
    rig.fake.answer("lista", "error_in_200")
    const noRight = (await rig.request()).fetch
    rig.dispatcher()
    assert.deepEqual((await rig.ends(noRight, "failed")).errors, ["fara_drept_cif"])
    rig.fake.answer("lista", "too_old")
    const tooOld = (await rig.request()).fetch
    assert.deepEqual((await rig.ends(tooOld, "failed")).errors, [FAKE_TOO_OLD])
    assert.equal(rig.listCalls().length, 2, "neither is asked again")
    assert.equal(await rig.coveredUntil(), undefined)
  }))
