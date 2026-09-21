import assert from "node:assert/strict"
import test from "node:test"

import { vatChangeFromSelection, vatSettingsSelection, vatSettingsStatus } from "./issuer-settings-state.ts"

void test("generates article 310 automatically from the existing non-VAT setting", () => {
  const selection = vatSettingsSelection(null, "2026-09-16")
  assert.deepEqual(selection, { registered: false, effectiveFrom: "2026-09-16" })
  assert.deepEqual(vatChangeFromSelection(selection), { registered: false, effectiveFrom: "2026-09-16", nonVatBasis: "article_310" })
})

void test("preserves the saved registration date and generates basis only for non-VAT status", () => {
  const saved = vatSettingsSelection({ registered: false, effectiveFrom: "2026-01-01", nonVatBasis: "article_310" }, "2026-09-16")
  assert.deepEqual(vatChangeFromSelection(saved), { registered: false, effectiveFrom: "2026-01-01", nonVatBasis: "article_310" })
  assert.deepEqual(vatChangeFromSelection({ registered: true, effectiveFrom: "2026-10-01" }),
    { registered: true, effectiveFrom: "2026-10-01" })
  assert.deepEqual(vatChangeFromSelection({ registered: false, effectiveFrom: "2026-11-01" }),
    { registered: false, effectiveFrom: "2026-11-01", nonVatBasis: "article_310" })
})

void test("describes current, scheduled, and expired VAT settings", () => {
  assert.equal(vatSettingsStatus(true, undefined), "Firma este configurată ca plătitoare de TVA.")
  assert.equal(vatSettingsStatus(false, undefined), "Firma este configurată ca neplătitoare de TVA.")
  assert.equal(
    vatSettingsStatus(true, { timing: "scheduled", effectiveFrom: "2026-10-01" }),
    "Regimul plătitor de TVA este programat de la 2026-10-01.",
  )
  assert.equal(
    vatSettingsStatus(false, { timing: "scheduled", effectiveFrom: "2026-10-01" }),
    "Regimul neplătitor de TVA este programat de la 2026-10-01.",
  )
  assert.equal(
    vatSettingsStatus(true, { timing: "expired", effectiveFrom: "2026-01-01" }),
    "Ultimul regim plătitor de TVA a expirat; alege data unei schimbări pentru reactivare.",
  )
  assert.equal(
    vatSettingsStatus(false, { timing: "expired", effectiveFrom: "2026-01-01" }),
    "Ultimul regim neplătitor de TVA a expirat; alege data unei schimbări pentru reactivare.",
  )
})
