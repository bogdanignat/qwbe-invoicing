import assert from "node:assert/strict"
import test from "node:test"

import {
  FISCAL_STATES, FISCAL_TRANSITIONS, archiveFor, canStoreArchive, canSupersede, fiscalTransition, type FiscalEvent, type FiscalState,
} from "./states.ts"

const events = Object.keys(FISCAL_TRANSITIONS) as ReadonlyArray<FiscalEvent>

/** The whole table, written out once more by hand: a change to either side shows up here. */
const allowed: ReadonlyArray<readonly [FiscalState, FiscalEvent, FiscalState]> = [
  ["queued", "validation_started", "validating"],
  ["validating", "validation_passed", "uploading"],
  ["validating", "validation_failed", "refused"],
  ["validating", "validation_retry", "queued"],
  ["uploading", "upload_indexed", "processing"],
  ["uploading", "upload_refused", "refused"],
  ["uploading", "upload_auth_refused", "queued"],
  ["uploading", "upload_ambiguous", "unknown"],
  ["processing", "processing_accepted", "accepted"],
  ["processing", "processing_rejected", "rejected"],
  ["processing", "processing_refused", "refused"],
  ["uploading", "recovered_upload", "unknown"],
  ["validating", "recovered_validation", "queued"],
  ["queued", "restored", "unknown"],
  ["validating", "restored", "unknown"],
  ["uploading", "restored", "unknown"],
  ["unknown", "linked", "processing"],
]

void test("every (state, event) pair is either in the table or refused", () => {
  for (const state of FISCAL_STATES) {
    for (const event of events) {
      const expected = allowed.find(([from, on]) => from === state && on === event)?.[2]
      assert.equal(fiscalTransition(state, event), expected, `${state} --${event}-->`)
    }
  }
})

void test("uploading goes back to queued only on an explicit authentication refusal; every other open end is unknown", () => {
  const fromUploading = events.filter((event) => fiscalTransition("uploading", event) !== undefined)
  assert.deepEqual(fromUploading.filter((event) => fiscalTransition("uploading", event) === "queued"), ["upload_auth_refused"])
  assert.deepEqual(fromUploading.map((event) => fiscalTransition("uploading", event)).sort(), ["processing", "queued", "refused", "unknown", "unknown", "unknown"])
})

void test("unknown is left only by a confirmed link, and the decided states are final", () => {
  assert.deepEqual(events.filter((event) => fiscalTransition("unknown", event) !== undefined), ["linked"])
  for (const state of ["accepted", "rejected", "refused"] as const) {
    assert.deepEqual(events.filter((event) => fiscalTransition(state, event) !== undefined), [], state)
  }
})

void test("only unknown can be superseded; the archive opens with a decision and is stored once", () => {
  assert.deepEqual(FISCAL_STATES.filter(canSupersede), ["unknown"])
  assert.deepEqual(FISCAL_STATES.filter((state) => archiveFor(state) === "pending"), ["accepted", "rejected"])
  assert.equal(canStoreArchive("accepted", "pending"), true)
  assert.equal(canStoreArchive("rejected", "pending"), true)
  assert.equal(canStoreArchive("accepted", "stored"), false)
  assert.equal(canStoreArchive("processing", "pending"), false)
})
