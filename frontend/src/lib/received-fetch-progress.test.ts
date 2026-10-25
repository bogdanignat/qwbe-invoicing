import assert from "node:assert/strict"
import test from "node:test"

import {
  fetchActive, fetchFailureText, fetchFinished, fetchProgressView, RECEIVED_POLL_MS, statusPollInterval,
} from "./received-fetch-progress.ts"
import type { FetchState, ReceivedFetch } from "./received-models.ts"

const receivedFetch = (state: FetchState, overrides: Partial<ReceivedFetch> = {}): ReceivedFetch => ({
  id: "f-1", state, window: { start: "2026-09-01T09:00:00.000Z", end: "2026-10-23T09:00:00.000Z", gap: undefined },
  pagesListed: 0, pagesTotal: 0, found: 0, queued: 0, downloaded: 0, failed: 0, errors: [], ...overrides,
})

void test("only listing and downloading are active, and only then is the status polled", () => {
  const states: ReadonlyArray<FetchState> = ["listing", "downloading", "completed", "failed"]
  assert.deepEqual(states.map((state) => fetchActive(receivedFetch(state))), [true, true, false, false])
  assert.deepEqual(states.map((state) => statusPollInterval({ fetch: receivedFetch(state), coveredUntil: null })),
    [RECEIVED_POLL_MS, RECEIVED_POLL_MS, false, false])
  assert.equal(statusPollInterval({ fetch: null, coveredUntil: null }), false)
  assert.equal(statusPollInterval(undefined), false)
})

void test("a fetch is finished when the one seen active is over or replaced, never when it was not active", () => {
  const listing = receivedFetch("listing")
  assert.equal(fetchFinished(listing, receivedFetch("completed")), true)
  assert.equal(fetchFinished(listing, receivedFetch("failed")), true)
  assert.equal(fetchFinished(listing, receivedFetch("downloading")), false)
  assert.equal(fetchFinished(listing, receivedFetch("listing", { id: "f-2" })), true)
  assert.equal(fetchFinished(undefined, receivedFetch("completed")), false, "the first read of the page")
  assert.equal(fetchFinished(receivedFetch("completed"), receivedFetch("completed")), false)
})

void test("the progress while listing and downloading, in the dispatcher's own counts", () => {
  assert.equal(fetchProgressView(receivedFetch("listing")).text, "Preluare în curs: se cere lista mesajelor din SPV…")
  assert.equal(fetchProgressView(receivedFetch("listing", { pagesListed: 1, pagesTotal: 2, found: 11 })).text,
    "Preluare în curs: lista din SPV, pagina 1 din 2; găsite până acum: 11.")
  const downloading = fetchProgressView(receivedFetch("downloading", { found: 24, queued: 5, downloaded: 2, failed: 1 }))
  assert.deepEqual([downloading.active, downloading.tone, downloading.text],
    [true, "info", "Preluare în curs: descărcate 2 din 5 facturi noi; eșuate: 1."])
})

void test("the result says how many were found, new and failed, and failures are retried by the next fetch", () => {
  const done = fetchProgressView(receivedFetch("completed", { found: 24, queued: 3, downloaded: 3 }))
  assert.deepEqual([done.active, done.tone, done.text],
    [false, "positive", "Preluarea din 23.10.2026, 12:00 s-a încheiat: găsite în SPV: 24, noi: 3, eșuate: 0."])
  const partial = fetchProgressView(receivedFetch("completed", { found: 4, queued: 4, downloaded: 3, failed: 1 }))
  assert.equal(partial.tone, "warning")
  assert.match(partial.text, /eșuate: 1\. Facturile eșuate se reiau la următoarea preluare\.$/u)
})

void test("a failed fetch names why: the dispatcher's codes in Romanian, ANAF's own text as it came", () => {
  const failed = fetchProgressView(receivedFetch("failed", { errors: ["token_refuzat", "Nu exista drept"] }))
  assert.deepEqual([failed.tone, failed.errors], ["warning", [fetchFailureText("token_refuzat"), "ANAF: Nu exista drept"]])
  assert.match(failed.text, /^Preluarea din 23\.10\.2026, 12:00 nu s-a încheiat/u)
  assert.match(fetchFailureText("fereastra_expirata"), /60 de zile/u)
})

void test("a gap before the window is said out loud; without one, nothing", () => {
  const gap = { from: "2026-07-01T09:00:00.000Z", until: "2026-08-24T09:15:00.000Z" }
  const view = fetchProgressView(receivedFetch("listing", { window: { start: gap.until, end: "2026-10-23T09:00:00.000Z", gap } }))
  assert.equal(view.gap, "ANAF nu mai listează perioada 01.07.2026, 12:00 – 24.08.2026, 12:15: facturile primite atunci nu pot fi preluate de aici.")
  assert.equal(fetchProgressView(receivedFetch("listing")).gap, undefined)
})
