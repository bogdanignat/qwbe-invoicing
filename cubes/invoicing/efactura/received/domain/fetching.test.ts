import assert from "node:assert/strict"
import test from "node:test"

import {
  MAX_DOWNLOAD_ATTEMPTS, START_MARGIN_MS, advancesCoverage, fetchWindow, isReceivedInvoice, listable, listableFrom, retriable,
} from "./fetching.ts"

const DAY_MS = 86_400_000
const NOW = new Date("2026-10-23T12:00:00.000Z")
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS).toISOString()

void test("a first fetch lists all ANAF still lists: 60 days back, a margin inside, up to now, with no gap", () => {
  const window = fetchWindow(NOW, undefined)
  assert.deepEqual(window, { start: new Date(NOW.getTime() - 60 * DAY_MS + START_MARGIN_MS).toISOString(), end: NOW.toISOString() })
  assert.equal(Date.parse(window.start), listableFrom(NOW))
})

void test("a later fetch starts one day before the coverage, so the edge is listed twice rather than never", () => {
  assert.deepEqual(fetchWindow(NOW, daysAgo(10)), { start: daysAgo(11), end: NOW.toISOString() })
})

void test("a coverage within the 60 days but whose overlap is not leaves no gap, only a shorter overlap", () => {
  const window = fetchWindow(NOW, daysAgo(59.5))
  assert.equal(window.start, new Date(listableFrom(NOW)).toISOString())
  assert.equal(window.gap, undefined)
})

void test("a coverage older than ANAF still lists leaves a gap the window says out loud", () => {
  const window = fetchWindow(NOW, daysAgo(75))
  assert.equal(window.start, new Date(listableFrom(NOW)).toISOString())
  assert.deepEqual(window.gap, { from: daysAgo(75), until: window.start })
})

void test("a window stays listable until its start is 60 days old, then a fetch must fail rather than ask", () => {
  const { start } = fetchWindow(NOW, undefined)
  assert.equal(listable(start, NOW), true)
  assert.equal(listable(start, new Date(NOW.getTime() + START_MARGIN_MS)), true)
  assert.equal(listable(start, new Date(NOW.getTime() + START_MARGIN_MS + 1)), false)
})

void test("only FACTURA PRIMITA is a received invoice", () => {
  const message = (type: string) => ({ id: "1", uploadIndex: "2", cif: "3", type, createdAt: "202610231015", details: "" })
  assert.equal(isReceivedInvoice(message("FACTURA PRIMITA")), true)
  assert.equal(isReceivedInvoice(message(" factura primita ")), true)
  for (const type of ["FACTURA TRIMISA", "ERORI FACTURA", "MESAJ CUMPARATOR PRIMIT / MESAJ CUMPARATOR TRANSMIS"]) {
    assert.equal(isReceivedInvoice(message(type)), false, type)
  }
})

void test("a message is tried at most three times; one given up holds the coverage back", () => {
  assert.equal(MAX_DOWNLOAD_ATTEMPTS, 3)
  assert.deepEqual([1, 2, 3].map(retriable), [true, true, false])
  assert.equal(advancesCoverage(0), true)
  assert.equal(advancesCoverage(1), false)
})
