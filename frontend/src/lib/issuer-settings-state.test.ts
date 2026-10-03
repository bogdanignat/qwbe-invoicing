import assert from "node:assert/strict"
import test from "node:test"

import {
  vatChangeFromSelection, vatSelectionStatus, vatSettingsSelection, vatSettingsStatus,
} from "./issuer-settings-state.ts"

const REGISTERED = { registered: true, effectiveFrom: "2026-08-01" }

void test("VAT selection — opens on the saved regime", () => {
  assert.deepEqual(vatSettingsSelection({ registered: true, effectiveFrom: "2026-08-01" }, "2026-09-25"), REGISTERED)
  assert.deepEqual(
    vatSettingsSelection({ registered: false, nonVatBasis: "article_310", effectiveFrom: "2026-01-01" }, "2026-09-25"),
    { registered: false, effectiveFrom: "2026-01-01" },
  )
})

void test("VAT selection — a profile with no regime opens on today, not registered", () => {
  assert.deepEqual(vatSettingsSelection(null, "2026-09-25"), { registered: false, effectiveFrom: "2026-09-25" })
  assert.deepEqual(vatSettingsSelection(undefined, "2026-09-25"), { registered: false, effectiveFrom: "2026-09-25" })
})

void test("VAT change — the exemption basis is sent only when the issuer stops charging VAT", () => {
  assert.deepEqual(vatChangeFromSelection(REGISTERED), { registered: true, effectiveFrom: "2026-08-01" })
  assert.deepEqual(vatChangeFromSelection({ registered: false, effectiveFrom: "2026-09-25" }), {
    registered: false, effectiveFrom: "2026-09-25", nonVatBasis: "article_310",
  })
})

void test("VAT status — reads the saved regime, including one only scheduled or already over", () => {
  assert.equal(vatSettingsStatus(true, undefined), "Firma este configurată ca plătitoare de TVA.")
  assert.equal(vatSettingsStatus(false, undefined), "Firma este configurată ca neplătitoare de TVA.")
  assert.equal(
    vatSettingsStatus(true, { timing: "scheduled", effectiveFrom: "2026-10-01" }),
    "Regimul plătitor de TVA este programat de la 2026-10-01.",
  )
  assert.equal(
    vatSettingsStatus(false, { timing: "expired", effectiveFrom: "2026-01-01" }),
    "Ultimul regim neplătitor de TVA a expirat; alege data unei schimbări pentru reactivare.",
  )
})

void test("VAT status — an unsaved choice says so instead of describing the profile", () => {
  assert.equal(
    vatSelectionStatus({ registered: false, effectiveFrom: "2026-09-25" }, REGISTERED, undefined),
    "Regimul neplătitor de TVA a fost ales manual.",
  )
  assert.equal(
    vatSelectionStatus(REGISTERED, { registered: false, effectiveFrom: "2026-08-01" }, undefined),
    "Regimul plătitor de TVA a fost ales manual.",
  )
})

void test("VAT status — a moved date is reported without touching the regime", () => {
  assert.equal(
    vatSelectionStatus({ registered: true, effectiveFrom: "2026-09-25" }, REGISTERED, undefined),
    "Data schimbării regimului TVA a fost modificată.",
  )
})

void test("VAT status — an untouched form shows what the saved profile says", () => {
  assert.equal(vatSelectionStatus(REGISTERED, REGISTERED, undefined), "Firma este configurată ca plătitoare de TVA.")
  assert.equal(
    vatSelectionStatus(REGISTERED, REGISTERED, { timing: "scheduled", effectiveFrom: "2026-08-01" }),
    "Regimul plătitor de TVA este programat de la 2026-08-01.",
  )
})
