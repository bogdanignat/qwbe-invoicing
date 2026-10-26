import assert from "node:assert/strict"
import test from "node:test"

import { maximumRegisterSearchLength, normalizeRegisterFilter, registerFilterIssues } from "./register.ts"

void test("an empty or complete register filter is accepted", () => {
  assert.deepEqual(registerFilterIssues({}), [])
  assert.deepEqual(registerFilterIssues({ from: "2024-02-29", to: "2024-02-29", kind: "correction", search: "FCT 12" }), [])
  assert.deepEqual(registerFilterIssues({ search: "x".repeat(maximumRegisterSearchLength) }), [])
})

void test("each refusal of the register filter names its field", () => {
  assert.deepEqual(registerFilterIssues({ from: "2026-09-30", to: "2026-09-01" }), ["from must not be after to"])
  assert.deepEqual(registerFilterIssues({ from: "2025-02-29", to: "2026-13-01" }), [
    "from must be a calendar date in YYYY-MM-DD format", "to must be a calendar date in YYYY-MM-DD format",
  ])
  assert.deepEqual(registerFilterIssues({ kind: "proforma" as "invoice" }), ["kind must be invoice or correction"])
  assert.deepEqual(registerFilterIssues({ search: "x".repeat(maximumRegisterSearchLength + 1) }), ["q must be at most 100 characters"])
  assert.deepEqual(registerFilterIssues({ search: "a\nb" }), ["q must not contain control characters"])
})

void test("a blank search is no search and a search is trimmed", () => {
  assert.deepEqual(normalizeRegisterFilter({ kind: "invoice", search: "   " }), { kind: "invoice", search: undefined })
  assert.deepEqual(normalizeRegisterFilter({ search: "  FCT 12 " }), { search: "FCT 12" })
  assert.deepEqual(normalizeRegisterFilter({ from: "2026-09-01" }), { from: "2026-09-01", search: undefined })
})
