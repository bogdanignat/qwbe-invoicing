import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { normalizeProductPreset } from "./product-preset.ts"

const each = { code: "C62", name: "unitate" }
const today = "2026-09-01"

void test("normalizes a preset: trimmed description, money to two decimals, known unit", () => {
  assert.deepEqual(normalizeProductPreset({ description: "  Consultanță  ", unitPrice: "12.5", unitOfMeasure: each }, today),
    { description: "Consultanță", unitPrice: "12.50", unitOfMeasure: each })
})

void test("rejects a blank description, a third decimal and an unknown unit", () => {
  assert.throws(() => normalizeProductPreset({ description: "   ", unitPrice: "1", unitOfMeasure: each }, today), ValidationFailure)
  assert.throws(() => normalizeProductPreset({ description: "Audit", unitPrice: "1.001", unitOfMeasure: each }, today), ValidationFailure)
  assert.throws(() => normalizeProductPreset({ description: "Audit", unitPrice: "1", unitOfMeasure: { code: "ZZZ", name: "necunoscut" } }, today), ValidationFailure)
})

void test("keeps a preferred VAT rate as a taxable code in force on the organization's date", () => {
  const base = { description: "Carte", unitPrice: "10", unitOfMeasure: each }
  for (const code of ["RO_STANDARD", "RO_REDUCED"]) {
    assert.equal(normalizeProductPreset({ ...base, preferredVatRateCode: code }, today).preferredVatRateCode, code)
  }
  assert.equal(normalizeProductPreset({ ...base, preferredVatRateCode: "RO_REDUCED_5" }, "2025-07-31").preferredVatRateCode, "RO_REDUCED_5")
  assert.equal(Object.hasOwn(normalizeProductPreset(base, today), "preferredVatRateCode"), false)
})

void test("refuses Article 310, a retired rate and an unknown code as a product's preference", () => {
  const base = { description: "Carte", unitPrice: "10", unitOfMeasure: each }
  for (const [code, date] of [["RO_NON_VAT", today], ["RO_REDUCED_5", "2025-08-01"], ["RO_SUPER", today], ["", today]] as const) {
    assert.throws(() => normalizeProductPreset({ ...base, preferredVatRateCode: code }, date), ValidationFailure, `${code} on ${date}`)
  }
})
