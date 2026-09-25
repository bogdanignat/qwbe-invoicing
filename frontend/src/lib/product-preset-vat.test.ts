import assert from "node:assert/strict"
import test from "node:test"

import { preferableVatRates, presetVatIssue, presetVatLabel, presetVatOptions } from "./product-preset-vat.ts"
import type { VatCatalogue } from "./draft-models.ts"

/**
 * The legacy app asserted these rules through rendered markup
 * (`web/src/components/catalog/product-preset-vat.test.ts`). They are facts
 * about the rates, not about a `<select>`, so they are asserted on the
 * functions here and the component is left with nothing to decide.
 */
const standard = { vatCategoryCode: "S", vatExemptionReason: null } as const
const notSubject = {
  vatCategoryCode: "O", vatExemptionReason: "Regim special de scutire conform art. 310 din Codul fiscal",
} as const
const catalogue: VatCatalogue = { rates: [
  { ...standard, code: "RO_STANDARD", rate: "19.00", kind: "standard", label: "TVA standard 19%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { ...standard, code: "RO_REDUCED_5", rate: "5.00", kind: "reduced", label: "TVA redus 5%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { ...standard, code: "RO_STANDARD", rate: "21.00", kind: "standard", label: "TVA standard 21%", effectiveFrom: "2025-08-01" },
  { ...standard, code: "RO_REDUCED", rate: "11.00", kind: "reduced", label: "TVA redus 11%", effectiveFrom: "2025-08-01" },
  { ...notSubject, code: "RO_NON_VAT", rate: "0.00", kind: "non_vat", label: "Scutit TVA — art. 310", effectiveFrom: "2025-01-01" },
] }

void test("only taxable rates in force may be preferred by a product", () => {
  assert.deepEqual(preferableVatRates(catalogue, "2025-08-01").map(({ code }) => code), ["RO_STANDARD", "RO_REDUCED"])
  assert.deepEqual(preferableVatRates(catalogue, "2025-07-31").map(({ code }) => code), ["RO_STANDARD", "RO_REDUCED_5"])
  // Article 310 is a status of the issuer, never of a product.
  assert.equal(preferableVatRates(catalogue, "2025-08-01").some(({ kind }) => kind === "non_vat"), false)
})

void test("an expired preference keeps an option of its own and blocks the save until it is replaced", () => {
  const rates = preferableVatRates(catalogue, "2025-08-01")
  assert.deepEqual(presetVatOptions(rates, [undefined, ""]).map(({ value }) => value), ["", "RO_STANDARD", "RO_REDUCED"])
  assert.deepEqual(presetVatOptions(rates, ["RO_REDUCED", "RO_STANDARD"]).map(({ value }) => value), ["", "RO_STANDARD", "RO_REDUCED"])
  // Chosen on 31 July, still on screen on 1 August: the choice keeps its option,
  // listed once however many times it is retained, instead of falling back silently.
  assert.deepEqual(presetVatOptions(rates, ["RO_REDUCED_5", "RO_REDUCED_5"]), [
    { value: "", label: "Implicită emitentului" }, { value: "RO_REDUCED_5", label: "RO_REDUCED_5 (expirată)" },
    { value: "RO_STANDARD", label: "TVA standard 21%" }, { value: "RO_REDUCED", label: "TVA redus 11%" },
  ])
  assert.match(presetVatIssue("RO_REDUCED_5", rates) ?? "", /nu mai este în vigoare/u)
  for (const choice of ["", "RO_STANDARD", "RO_REDUCED"]) assert.equal(presetVatIssue(choice, rates), null)
})

void test("a saved preference is named on the registry row, expired or not", () => {
  const rates = preferableVatRates(catalogue, "2025-08-01")
  assert.equal(presetVatLabel(undefined, rates), "Implicită emitentului")
  assert.equal(presetVatLabel("RO_REDUCED", rates), "TVA redus 11%")
  assert.equal(presetVatLabel("RO_REDUCED_5", rates), "RO_REDUCED_5 (expirată)")
})
