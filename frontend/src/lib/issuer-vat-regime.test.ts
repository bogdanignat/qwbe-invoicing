import assert from "node:assert/strict"
import test from "node:test"

import { fallbackVatRegistration, vatRegistrationHistory } from "./issuer-vat-regime.ts"
import type { VatCatalogue, VatConfiguration, VatRate } from "./draft-models.ts"

const ARTICLE_310 = "Regim special de scutire conform art. 310 din Codul fiscal"

const standard = (effectiveFrom: string, effectiveTo?: string): VatConfiguration => ({
  code: "RO_STANDARD", rate: "21", vatCategoryCode: "S", vatExemptionReason: null,
  effectiveFrom, ...(effectiveTo === undefined ? {} : { effectiveTo }),
})

const reduced = (effectiveFrom: string, effectiveTo?: string): VatConfiguration => ({
  code: "RO_REDUCED", rate: "11", vatCategoryCode: "S", vatExemptionReason: null,
  effectiveFrom, ...(effectiveTo === undefined ? {} : { effectiveTo }),
})

const exempt = (effectiveFrom: string, effectiveTo?: string): VatConfiguration => ({
  code: "RO_NON_VAT", rate: "0", vatCategoryCode: "O", vatExemptionReason: ARTICLE_310,
  effectiveFrom, ...(effectiveTo === undefined ? {} : { effectiveTo }),
})

const rate = (configuration: VatConfiguration, kind: VatRate["kind"], label: string): VatRate =>
  ({ ...configuration, kind, label })

const catalogue: VatCatalogue = {
  rates: [
    rate(standard("2026-08-01"), "standard", "TVA 21%"),
    rate(reduced("2026-08-01"), "reduced", "TVA redus 11%"),
  ],
}

void test("fallback VAT registration — prefers a change that is scheduled over one that expired", () => {
  const configurations = [exempt("2026-01-01", "2026-08-31"), standard("2026-10-01")]
  assert.deepEqual(fallbackVatRegistration(configurations, "2026-09-15"), {
    registered: true, effectiveFrom: "2026-10-01", timing: "scheduled",
  })
})

void test("fallback VAT registration — reads the last regime that ended when nothing is scheduled", () => {
  const configurations = [exempt("2026-01-01", "2026-08-31")]
  assert.deepEqual(fallbackVatRegistration(configurations, "2026-09-15"), {
    registered: false, nonVatBasis: "article_310", effectiveFrom: "2026-01-01", timing: "expired",
  })
})

void test("fallback VAT registration — answers nothing when a regime covers the date, and leaves the input untouched", () => {
  const configurations = [standard("2026-01-01"), reduced("2026-01-01")]
  assert.equal(fallbackVatRegistration(configurations, "2026-09-15"), undefined)
  assert.deepEqual(configurations, [standard("2026-01-01"), reduced("2026-01-01")])
})

void test("fallback VAT registration — answers nothing when the neighbouring period mixes regimes", () => {
  assert.equal(fallbackVatRegistration([standard("2026-10-01"), exempt("2026-10-01")], "2026-09-15"), undefined)
})

void test("VAT history — groups the rates of one period and labels them from the catalogue", () => {
  const history = vatRegistrationHistory(
    [standard("2026-08-01"), reduced("2026-08-01"), exempt("2026-01-01", "2026-07-31")],
    catalogue,
  )
  assert.deepEqual(history, [
    { effectiveFrom: "2026-08-01", rates: "TVA 21%, TVA redus 11%", registered: true },
    { effectiveFrom: "2026-01-01", effectiveTo: "2026-07-31", rates: "0%", registered: false },
  ])
})

void test("VAT history — reports a period whose rates name no regime instead of throwing", () => {
  const history = vatRegistrationHistory([standard("2026-08-01"), exempt("2026-08-01")], catalogue)
  assert.equal(history.length, 1)
  assert.equal(history[0]?.registered, undefined)
})

void test("VAT history — has nothing to show for an issuer with no configurations", () => {
  assert.deepEqual(vatRegistrationHistory([], catalogue), [])
})
