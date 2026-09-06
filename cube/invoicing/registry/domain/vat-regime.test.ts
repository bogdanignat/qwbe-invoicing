import assert from "node:assert/strict"
import test from "node:test"

import { effectiveVatConfiguration, inferVatRegime, romanianVatRegimes, scheduleVatRegime } from "./vat-regime.ts"

void test("infers the regime from the RO prefix of a Romanian identifier and nothing else", () => {
  assert.equal(inferVatRegime("RO", "45561046")?.code, "RO_NON_VAT")
  assert.equal(inferVatRegime("ro", " ro45561046 ")?.code, "RO_STANDARD")
  assert.equal(inferVatRegime("RO", "ROBERT"), undefined)
  assert.equal(inferVatRegime("RO", " RO "), undefined)
  assert.equal(inferVatRegime("DE", "DE123456789"), undefined)
  assert.deepEqual(romanianVatRegimes.map(({ code, rate }) => `${code}=${rate}`), ["RO_STANDARD=21.00", "RO_REDUCED=11.00", "RO_NON_VAT=0.00"])
})

void test("resolves the configuration in force on a date, else the nearest scheduled one", () => {
  const history = [
    { code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-08-01", effectiveTo: "2026-12-31" },
    { code: "RO_NON_VAT", rate: "0.00", effectiveFrom: "2027-01-01" },
  ]
  assert.equal(effectiveVatConfiguration(history, "2026-09-05")?.code, "RO_STANDARD")
  assert.equal(effectiveVatConfiguration(history, "2027-03-01")?.code, "RO_NON_VAT")
  assert.equal(effectiveVatConfiguration(history, "2024-01-01")?.code, "RO_STANDARD")
  assert.equal(effectiveVatConfiguration([], "2026-09-05"), undefined)
})

void test("schedules a regime by closing the open period and replacing later schedules", () => {
  const existing = [{ code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-08-01" }]
  assert.deepEqual(scheduleVatRegime(existing, { code: "RO_NON_VAT", rate: "0.00", effectiveFrom: "2026-08-31" }), [
    { code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-08-01", effectiveTo: "2026-08-30" },
    { code: "RO_NON_VAT", rate: "0.00", effectiveFrom: "2026-08-31" },
  ])
  assert.equal(scheduleVatRegime(existing, { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01" }), existing)
  const scheduled = [
    { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01", effectiveTo: "2026-12-31" },
    { code: "RO_NON_VAT", rate: "0", effectiveFrom: "2027-01-01" },
  ]
  const replaced = scheduleVatRegime(scheduled, { code: "RO_REDUCED", rate: "11.00", effectiveFrom: "2026-10-01" })
  assert.deepEqual(replaced, [
    { code: "RO_STANDARD", rate: "21", effectiveFrom: "2025-08-01", effectiveTo: "2026-09-30" },
    { code: "RO_REDUCED", rate: "11.00", effectiveFrom: "2026-10-01" },
  ])
  assert.equal(scheduleVatRegime(replaced, { code: "RO_REDUCED", rate: "11.00", effectiveFrom: "2026-10-01" }), replaced)
})
