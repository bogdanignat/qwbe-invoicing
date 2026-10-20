import assert from "node:assert/strict"
import test from "node:test"

import {
  NEVER_PAUSED, bucharestDay, nextBucharestMidnight, pauseAfterRateLimit, reserveMessageCall, reserveOrganizationCall, retryAfterSeconds,
  type OrganizationBudget,
} from "./budgets.ts"
import { nextPollAt, pollDelayMinutes } from "./polling.ts"

const at = (iso: string) => new Date(iso)

void test("the daily counters belong to the Bucharest day, summer and winter", () => {
  assert.equal(bucharestDay(at("2026-07-14T20:59:59.999Z")), "2026-07-14")
  assert.equal(bucharestDay(at("2026-07-14T21:00:00.000Z")), "2026-07-15")
  assert.equal(bucharestDay(at("2026-01-14T21:59:59.999Z")), "2026-01-14")
  assert.equal(bucharestDay(at("2026-01-14T22:00:00.000Z")), "2026-01-15")
  assert.equal(nextBucharestMidnight(at("2026-07-14T10:00:00.000Z")).toISOString(), "2026-07-14T21:00:00.000Z")
  assert.equal(nextBucharestMidnight(at("2026-01-14T22:30:00.000Z")).toISOString(), "2026-01-15T22:00:00.000Z")
  // The nights the clocks change: the day of the change is 23 or 25 hours long.
  assert.equal(nextBucharestMidnight(at("2026-03-29T12:00:00.000Z")).toISOString(), "2026-03-29T21:00:00.000Z")
  assert.equal(nextBucharestMidnight(at("2026-10-25T12:00:00.000Z")).toISOString(), "2026-10-25T22:00:00.000Z")
})

void test("stareMesaj stops at 90 and descarcare at 9 calls per message per day, and both reset at Bucharest midnight", () => {
  const morning = at("2026-10-19T06:00:00.000Z")
  assert.deepEqual(reserveMessageCall("stareMesaj", undefined, morning), { day: "2026-10-19", used: 1 })
  assert.deepEqual(reserveMessageCall("stareMesaj", { day: "2026-10-19", used: 89 }, morning), { day: "2026-10-19", used: 90 })
  assert.equal(reserveMessageCall("stareMesaj", { day: "2026-10-19", used: 90 }, morning), undefined)
  assert.deepEqual(reserveMessageCall("descarcare", { day: "2026-10-19", used: 8 }, morning), { day: "2026-10-19", used: 9 })
  assert.equal(reserveMessageCall("descarcare", { day: "2026-10-19", used: 9 }, morning), undefined)
  // 21:30 UTC on 19 October is already the 20th in Bucharest.
  assert.deepEqual(reserveMessageCall("stareMesaj", { day: "2026-10-19", used: 90 }, at("2026-10-19T21:30:00.000Z")), { day: "2026-10-20", used: 1 })
})

void test("an organization makes at most 900 calls in a minute, then waits for the next one", () => {
  const now = at("2026-10-19T10:15:42.000Z")
  const busy: OrganizationBudget = { minute: "2026-10-19T10:15", used: 899, pausedUntil: NEVER_PAUSED }
  assert.deepEqual(reserveOrganizationCall(undefined, now), { granted: { minute: "2026-10-19T10:15", used: 1, pausedUntil: NEVER_PAUSED } })
  assert.deepEqual(reserveOrganizationCall(busy, now), { granted: { ...busy, used: 900 } })
  assert.deepEqual(reserveOrganizationCall({ ...busy, used: 900 }, now), { waitUntil: "2026-10-19T10:16:00.000Z" })
  assert.deepEqual(reserveOrganizationCall({ ...busy, used: 900 }, at("2026-10-19T10:16:00.000Z")),
    { granted: { minute: "2026-10-19T10:16", used: 1, pausedUntil: NEVER_PAUSED } })
})

void test("Retry-After is trusted only as whole seconds, held to 1..30; otherwise the pause is 30 seconds", () => {
  for (const [header, seconds] of [["5", 5], [" 7 ", 7], ["0", 1], ["30", 30], ["31", 30], ["86400", 30], [null, 30], [undefined, 30], ["", 30],
    ["1.5", 30], ["-1", 30], ["+3", 30], ["1e3", 30], ["Wed, 21 Oct 2026 07:28:00 GMT", 30], ["9999999999", 30]] as const) {
    assert.equal(retryAfterSeconds(header), seconds, String(header))
  }
})

void test("a 429 pauses the whole organization and never shortens a longer pause", () => {
  const now = at("2026-10-19T10:15:42.000Z")
  const paused = pauseAfterRateLimit(undefined, now, "10")
  assert.deepEqual(paused, { minute: "2026-10-19T10:15", used: 0, pausedUntil: "2026-10-19T10:15:52.000Z" })
  assert.deepEqual(reserveOrganizationCall(paused, at("2026-10-19T10:15:50.000Z")), { waitUntil: "2026-10-19T10:15:52.000Z" })
  assert.ok("granted" in reserveOrganizationCall(paused, at("2026-10-19T10:15:52.000Z")))
  assert.equal(pauseAfterRateLimit(paused, now, "2").pausedUntil, "2026-10-19T10:15:52.000Z")
  assert.equal(pauseAfterRateLimit(paused, now, null).pausedUntil, "2026-10-19T10:16:12.000Z")
})

void test("stareMesaj is polled after 1, 2, 5, 10 and 30 minutes, then hourly", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 40].map(pollDelayMinutes), [1, 2, 5, 10, 30, 60, 60, 60])
  assert.equal(nextPollAt(at("2026-10-19T10:00:00.000Z"), 2).toISOString(), "2026-10-19T10:05:00.000Z")
})
