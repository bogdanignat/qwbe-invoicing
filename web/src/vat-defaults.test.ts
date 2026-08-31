import assert from "node:assert/strict"
import test from "node:test"

import { currentEffectiveVat, hasStaleDraftTax, inferRomanianVatDefaults, nearestConfiguredVat, resolveVatValues, updateVatTimeline } from "./vat-defaults.ts"

void test("infers non-VAT defaults for a Romanian issuer whose CUI has no RO prefix", () => {
  assert.deepEqual(inferRomanianVatDefaults("RO", "45561046"), {
    registered: false,
    values: { code: "RO_NON_VAT", rate: "0.00" },
  })
})

void test("infers registered VAT only for a valid RO-prefixed numeric identifier", () => {
  assert.deepEqual(inferRomanianVatDefaults("ro", " ro45561046 "), {
    registered: true,
    values: { code: "RO_STANDARD", rate: "21.00" },
  })
  assert.equal(inferRomanianVatDefaults("RO", "ROBERT"), undefined)
})

void test("does not infer Romanian VAT defaults for incomplete or foreign identifiers", () => {
  assert.equal(inferRomanianVatDefaults("RO", ""), undefined)
  assert.equal(inferRomanianVatDefaults("RO", " RO "), undefined)
  assert.equal(inferRomanianVatDefaults("DE", "DE123456789"), undefined)
})

void test("explicit VAT registration is authoritative over the CUI suggestion", () => {
  assert.deepEqual(resolveVatValues(false, { code: "RO_STANDARD", rate: "21.00" }), {
    code: "RO_NON_VAT",
    rate: "0.00",
  })
  assert.deepEqual(resolveVatValues(true, { code: "RO_NON_VAT", rate: "0" }), {
    code: "RO_STANDARD",
    rate: "21.00",
  })
  assert.deepEqual(resolveVatValues(true, { code: "RO_STANDARD", rate: "19.00" }), {
    code: "RO_STANDARD",
    rate: "19.00",
  })
})

void test("detects draft tax snapshots that no longer match the effective issuer configuration", () => {
  const current = [{ code: "RO_NON_VAT", category: "standard" as const, rate: "0.00", effectiveFrom: "2026-01-01" }]
  assert.equal(hasStaleDraftTax("2026-09-01", [{ taxCode: "RO_NON_VAT", taxRate: "0.00" }], current), false)
  assert.equal(hasStaleDraftTax("2026-09-01", [{ taxCode: "RO_NON_VAT", taxRate: "0.00" }], [{ code: "RO_NON_VAT", category: "standard", rate: "0", effectiveFrom: "2026-01-01" }]), false)
  assert.equal(hasStaleDraftTax("2026-09-01", [{ taxCode: "RO_STANDARD", taxRate: "21.00" }], current), true)
  assert.equal(hasStaleDraftTax("2025-12-31", [{ taxCode: "RO_NON_VAT", taxRate: "0.00" }], current), true)
})

void test("preserves and closes VAT history when the current regime changes", () => {
  const existing = [{ code: "RO_STANDARD", category: "standard" as const, rate: "21.00", effectiveFrom: "2025-08-01" }]
  const current = currentEffectiveVat(existing, "2026-08-31")
  assert.deepEqual(updateVatTimeline(existing, current, { code: "RO_NON_VAT", rate: "0.00" }, "2026-08-31"), [
    { code: "RO_STANDARD", category: "standard", rate: "21.00", effectiveFrom: "2025-08-01", effectiveTo: "2026-08-30" },
    { code: "RO_NON_VAT", category: "standard", rate: "0.00", effectiveFrom: "2026-08-31" },
  ])
  assert.equal(updateVatTimeline(existing, current, { code: "RO_STANDARD", rate: "21" }, "2025-08-01"), existing)
})

void test("replaces future VAT schedules without overlap and is stable on repeated save", () => {
  const scheduled = [
    { code: "RO_STANDARD", category: "standard" as const, rate: "21", effectiveFrom: "2025-08-01", effectiveTo: "2026-12-31" },
    { code: "RO_NON_VAT", category: "standard" as const, rate: "0", effectiveFrom: "2027-01-01" },
  ]
  const updated = updateVatTimeline(scheduled, currentEffectiveVat(scheduled, "2026-08-31"), { code: "RO_STANDARD", rate: "19" }, "2026-09-01")
  assert.deepEqual(updated, [
    { code: "RO_STANDARD", category: "standard", rate: "21", effectiveFrom: "2025-08-01", effectiveTo: "2026-08-31" },
    { code: "RO_STANDARD", category: "standard", rate: "19", effectiveFrom: "2026-09-01" },
  ])
  assert.equal(updateVatTimeline(updated, currentEffectiveVat(updated, "2026-09-01"), { code: "RO_STANDARD", rate: "19.00" }, "2026-09-01"), updated)
})

void test("uses the nearest scheduled VAT configuration when today has no active period", () => {
  const future = [{ code: "RO_NON_VAT", category: "standard" as const, rate: "0", effectiveFrom: "2027-01-01" }]
  const nearest = nearestConfiguredVat(future, "2026-08-31")
  assert.equal(nearest, future[0])
  assert.deepEqual(updateVatTimeline(future, nearest, { code: "RO_NON_VAT", rate: "0.00" }, "2026-08-31"), [
    { code: "RO_NON_VAT", category: "standard", rate: "0.00", effectiveFrom: "2026-08-31" },
  ])
})
