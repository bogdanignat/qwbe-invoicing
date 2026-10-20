import assert from "node:assert/strict"
import test from "node:test"

import { setupGaps, type SetupCheck, type SetupState } from "./setup-gaps.ts"

const ready = <Value>(value: Value): SetupCheck<Value> => ({ kind: "ready", value })
const PENDING = { kind: "pending" } as const
const FAILED = { kind: "failed" } as const

const complete: SetupState = {
  plugins: { companyLookup: true, efactura: true },
  issuer: ready({}),
  series: ready([{ documentType: "invoice" }, { documentType: "proforma" }]),
  lookupProvider: ready("anaf"),
  anaf: ready({ status: "connected", refreshExpiryWarning: false }),
}

const codes = (state: Partial<SetupState>) => setupGaps({ ...complete, ...state })?.map((row) => row.code)

void test("a complete installation lists nothing, so the card is not shown", () => {
  assert.deepEqual(setupGaps(complete), [])
})

void test("no issuer profile and no series: each is a row pointing to Setări", () => {
  const rows = setupGaps({ ...complete, issuer: ready(null), series: ready([]) }) ?? []
  assert.deepEqual(rows.map((row) => [row.code, row.action?.href]), [
    ["issuer", "/settings"], ["invoice_series", "/settings"], ["proforma_series", "/settings"],
  ])
  assert.ok(rows.every((row) => row.message !== "" && row.action?.label !== ""))
})

void test("a series of one type does not stand for the other", () => {
  assert.deepEqual(codes({ series: ready([{ documentType: "invoice" }]) }), ["proforma_series"])
  assert.deepEqual(codes({ series: ready([{ documentType: "proforma" }]) }), ["invoice_series"])
})

void test("company lookup without a provider points to Integrări; any provider is enough", () => {
  assert.deepEqual(setupGaps({ ...complete, lookupProvider: ready("none") })?.map((row) => [row.code, row.action?.href]),
    [["company_lookup", "/integrations"]])
  assert.deepEqual(codes({ lookupProvider: ready("openapi") }), [])
})

void test("each ANAF state that needs a hand is a row to Integrări; not configured is a server fix, with no link", () => {
  const anaf = (status: SetupState["anaf"] extends SetupCheck<infer Value> ? Value : never) =>
    setupGaps({ ...complete, anaf: ready(status) })?.map((row) => [row.code, row.action?.href])
  assert.deepEqual(anaf({ status: "disconnected", refreshExpiryWarning: false }), [["anaf_disconnected", "/integrations"]])
  assert.deepEqual(anaf({ status: "needs_reconnect", refreshExpiryWarning: false }), [["anaf_needs_reconnect", "/integrations"]])
  assert.deepEqual(anaf({ status: "connected", refreshExpiryWarning: true }), [["anaf_expiring", "/integrations"]])
  assert.deepEqual(anaf({ status: "not_configured", refreshExpiryWarning: false }), [["anaf_not_configured", undefined]])
  const [notConfigured] = setupGaps({ ...complete, anaf: ready({ status: "not_configured", refreshExpiryWarning: false }) }) ?? []
  assert.match(notConfigured?.message ?? "", /ANAF_\*/u)
})

void test("with a plugin off its check never counts, whatever it holds", () => {
  const off = { ...complete, plugins: { companyLookup: false, efactura: false } }
  assert.deepEqual(setupGaps({ ...off, lookupProvider: ready("none"), anaf: ready({ status: "disconnected", refreshExpiryWarning: false }) }), [])
  // A disabled query stays pending forever: it must not hold the card back.
  assert.deepEqual(setupGaps({ ...off, issuer: ready(null), lookupProvider: PENDING, anaf: PENDING })?.map((row) => row.code), ["issuer"])
})

void test("nothing is listed while a counted check is still loading", () => {
  for (const pending of ["issuer", "series", "lookupProvider", "anaf"] as const) {
    assert.equal(setupGaps({ ...complete, issuer: ready(null), [pending]: PENDING }), undefined, pending)
  }
})

void test("a failed check adds no row and does not hold back the others", () => {
  assert.deepEqual(codes({ issuer: FAILED, series: ready([]) }), ["invoice_series", "proforma_series"])
  assert.deepEqual(codes({ lookupProvider: FAILED, anaf: FAILED }), [])
})
