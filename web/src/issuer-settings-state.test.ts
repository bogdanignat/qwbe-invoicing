import assert from "node:assert/strict"
import test from "node:test"

import { vatChangeFromSelection, vatSettingsSelection } from "./issuer-settings-state.ts"

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
