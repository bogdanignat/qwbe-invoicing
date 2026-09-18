import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../../contracts/failures.ts"
import { normalizeProductPreset } from "./product-preset.ts"

const each = { code: "C62", name: "unitate" }

void test("normalizes a preset: trimmed description, money to two decimals, known unit", () => {
  assert.deepEqual(normalizeProductPreset({ description: "  Consultanță  ", unitPrice: "12.5", unitOfMeasure: each }),
    { description: "Consultanță", unitPrice: "12.50", unitOfMeasure: each })
})

void test("rejects a blank description, a third decimal and an unknown unit", () => {
  assert.throws(() => normalizeProductPreset({ description: "   ", unitPrice: "1", unitOfMeasure: each }), ValidationFailure)
  assert.throws(() => normalizeProductPreset({ description: "Audit", unitPrice: "1.001", unitOfMeasure: each }), ValidationFailure)
  assert.throws(() => normalizeProductPreset({ description: "Audit", unitPrice: "1", unitOfMeasure: { code: "ZZZ", name: "necunoscut" } }), ValidationFailure)
})
