import assert from "node:assert/strict"
import test from "node:test"

import { canonicalVatTreatment } from "./draft-decoders.ts"
import { configurationRegistration, sameVatRate } from "./vat-defaults.ts"

const ARTICLE_310 = "Regim special de scutire conform art. 310 din Codul fiscal"

void test("two rates are the same by value: trimmed, at most three integer digits and two decimals", () => {
  for (const [left, right] of [["21", "21.00"], [" 21 ", "21.0"], ["021", "21"], ["0", "0.00"], ["100", "100.00"], ["999.99", "999.99"]] as const) {
    assert.equal(sameVatRate(left, right), true, `${left} = ${right}`)
  }
  for (const [left, right] of [["21", "21.01"], ["1000", "1000"], ["0021", "21"], ["21.001", "21.001"], ["-21", "-21"], ["abc", "abc"],
    ["", ""], ["+21", "21"], ["2e1", "20"], [".5", "0.5"], ["21.", "21"]] as const) {
    assert.equal(sameVatRate(left, right), false, `${left} ≠ ${right}`)
  }
})

void test("a regime is named only by canonical tuples: exemption at a zero rate, taxed at a positive one", () => {
  const exempt = (rate: string) => ({ code: "RO_NON_VAT", rate, vatCategoryCode: "O" as const, vatExemptionReason: ARTICLE_310,
    effectiveFrom: "2025-08-01" })
  const taxed = (rate: string) => ({ code: "RO_STANDARD", rate, vatCategoryCode: "S" as const, vatExemptionReason: null,
    effectiveFrom: "2025-08-01" })
  for (const rate of ["0", "0.00", " 0 ", "000"]) assert.equal(configurationRegistration([exempt(rate)]), false, rate)
  for (const rate of ["0.01", "abc", "1000", "0000"]) assert.equal(configurationRegistration([exempt(rate)]), undefined, rate)
  for (const rate of ["21", "0.01", " 21.00 ", "999"]) assert.equal(configurationRegistration([taxed(rate)]), true, rate)
  for (const rate of ["0", "0.00", "abc", "1000", "0021"]) assert.equal(configurationRegistration([taxed(rate)]), undefined, rate)
})

void test("the decoder admits a rate by the backend's grammar and range only", () => {
  const taxedOk = (rate: string) => { canonicalVatTreatment("RO_STANDARD", rate, "S", null) }
  for (const rate of ["0.01", "1", "21", "21.00", "99.99", "100", "100.00"]) assert.doesNotThrow(() => { taxedOk(rate) }, rate)
  for (const rate of ["100.01", "101", "021", "21.000", " 21", "+21", "-21", "1e1", ".5", "21.", ""]) {
    assert.throws(() => { taxedOk(rate) }, /^Error: invalid rate$/u, rate)
  }
  for (const rate of ["0", "0.00"]) assert.throws(() => { taxedOk(rate) }, /^Error: invalid VAT treatment$/u, rate)
  for (const rate of ["0", "0.0", "0.00"]) {
    assert.doesNotThrow(() => { canonicalVatTreatment("RO_NON_VAT", rate, "O", ARTICLE_310) }, rate)
  }
  assert.throws(() => { canonicalVatTreatment("RO_NON_VAT", "0.01", "O", ARTICLE_310) }, /^Error: invalid VAT treatment$/u)
})
