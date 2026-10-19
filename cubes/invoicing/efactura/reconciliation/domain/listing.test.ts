import assert from "node:assert/strict"
import test from "node:test"

import type { ListedMessage } from "../../submissions/index.ts"
import { MAX_WINDOW_DAYS, isOwnUpload, listOutcome, listWindow } from "./listing.ts"

const created = "2026-08-01T10:00:00.000Z"

void test("the window starts at the submission's creation, never passes now, and spans at most 60 days", () => {
  const start = Date.parse(created)
  assert.deepEqual(listWindow(created, new Date("2026-08-02T10:00:00.000Z")), { startTime: start, endTime: start + 86_400_000 })
  assert.deepEqual(listWindow(created, new Date("2026-12-01T00:00:00.000Z")), { startTime: start, endTime: start + MAX_WINDOW_DAYS * 86_400_000 })
  assert.deepEqual(listWindow(created, new Date("2026-07-31T00:00:00.000Z")), { startTime: start, endTime: start }, "a clock behind never inverts it")
})

void test("only this CIF's own uploads are candidates: a received invoice carries someone else's index", () => {
  const message = (type: string): ListedMessage => ({ id: "1", uploadIndex: "5001", cif: "12345674", type, createdAt: "202608011015", details: "" })
  assert.deepEqual(["FACTURA TRIMISA", "ERORI FACTURA", " factura trimisa ", "FACTURA PRIMITA", "MESAJ CUMPARATOR PRIMIT"]
    .map((type) => isOwnUpload(message(type))), [true, true, true, false, false])
})

void test("a list call is logged by what it was: transport failure, ANAF's refusal, or its answer", () => {
  const reply = { status: 200, retryAfter: null, body: "" }
  assert.equal(listOutcome("ambiguous", { kind: "unrecognized" }), "ambiguous")
  assert.equal(listOutcome("not_sent", { kind: "unrecognized" }), "not_sent")
  assert.equal(listOutcome(reply, { kind: "messages", messages: [], pages: 0 }), "answered")
  assert.equal(listOutcome(reply, { kind: "no_right" }), "anaf_error")
  assert.equal(listOutcome({ ...reply, status: 401 }, { kind: "auth_refused" }), "auth_refused")
  assert.equal(listOutcome({ ...reply, status: 429 }, { kind: "rate_limited", retryAfterSeconds: 7 }), "rate_limited")
})
