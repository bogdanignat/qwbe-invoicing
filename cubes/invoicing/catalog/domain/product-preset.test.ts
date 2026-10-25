import assert from "node:assert/strict"
import test from "node:test"

import { DomainConflict, ValidationFailure } from "../../contracts/failures.ts"
import { codeTakenConflict, normalizeProductPreset, productPresetCodeTaken } from "./product-preset.ts"

const each = { code: "C62", name: "unitate" }
const today = "2026-09-01"
const product = { code: "CONS-1", kind: "service" as const }
const issueOf = (error: unknown): string => error instanceof ValidationFailure ? error.issues.join("; ") : String(error)

void test("normalizes a preset: trimmed code and description, money to two decimals, known unit", () => {
  assert.deepEqual(normalizeProductPreset({ code: "  CONS-1 ", kind: "service", description: "  Consultanță  ", unitPrice: "12.5", unitOfMeasure: each }, today),
    { code: "CONS-1", kind: "service", description: "Consultanță", unitPrice: "12.50", unitOfMeasure: each })
})

void test("rejects a blank description, a third decimal and an unknown unit", () => {
  assert.throws(() => normalizeProductPreset({ ...product, description: "   ", unitPrice: "1", unitOfMeasure: each }, today), ValidationFailure)
  assert.throws(() => normalizeProductPreset({ ...product, description: "Audit", unitPrice: "1.001", unitOfMeasure: each }, today), ValidationFailure)
  assert.throws(() => normalizeProductPreset({ ...product, description: "Audit", unitPrice: "1", unitOfMeasure: { code: "ZZZ", name: "necunoscut" } }, today), ValidationFailure)
})

void test("keeps a preferred VAT rate as a taxable code in force on the organization's date", () => {
  const base = { ...product, description: "Carte", unitPrice: "10", unitOfMeasure: each }
  for (const code of ["RO_STANDARD", "RO_REDUCED"]) {
    assert.equal(normalizeProductPreset({ ...base, preferredVatRateCode: code }, today).preferredVatRateCode, code)
  }
  assert.equal(normalizeProductPreset({ ...base, preferredVatRateCode: "RO_REDUCED_5" }, "2025-07-31").preferredVatRateCode, "RO_REDUCED_5")
  assert.equal(Object.hasOwn(normalizeProductPreset(base, today), "preferredVatRateCode"), false)
})

void test("refuses Article 310, a retired rate and an unknown code as a product's preference", () => {
  const base = { ...product, description: "Carte", unitPrice: "10", unitOfMeasure: each }
  for (const [code, date] of [["RO_NON_VAT", today], ["RO_REDUCED_5", "2025-08-01"], ["RO_SUPER", today], ["", today]] as const) {
    assert.throws(() => normalizeProductPreset({ ...base, preferredVatRateCode: code }, date), ValidationFailure, `${code} on ${date}`)
  }
})

void test("bounds the description to the 100 characters an e-Factura item name may carry", () => {
  assert.equal(normalizeProductPreset({ ...product, description: ` ${"a".repeat(100)} `, unitPrice: "1", unitOfMeasure: each }, today).description, "a".repeat(100))
  assert.throws(() => normalizeProductPreset({ ...product, description: "a".repeat(101), unitPrice: "1", unitOfMeasure: each }, today),
    (error: unknown) => error instanceof ValidationFailure && error.issues.includes("description must be at most 100 characters"))
})

void test("requires an article code of 1-50 printable ASCII characters: no diacritics, no control, inner spaces allowed", () => {
  const base = { kind: "goods" as const, description: "Șurub", unitPrice: "1", unitOfMeasure: each }
  for (const code of ["x".repeat(50), "SRB/M6 #1 (v2.0)", "A-B C", "~!@{}"]) {
    assert.equal(normalizeProductPreset({ ...base, code: ` ${code} ` }, today).code, code)
  }
  for (const code of ["", "   ", "a".repeat(51), "A\tB", "A\u0085B", "A\u2028B", "\u007fAB", "A\u00a0B", "ȘURUB", "café", "😀"]) {
    assert.throws(() => normalizeProductPreset({ ...base, code }, today),
      (error: unknown) => issueOf(error) === "code must be 1-50 printable ASCII characters", JSON.stringify(code))
  }
})

void test("requires the kind to be goods or service", () => {
  const base = { code: "X", description: "Șurub", unitPrice: "1", unitOfMeasure: each }
  assert.equal(normalizeProductPreset({ ...base, kind: "goods" }, today).kind, "goods")
  for (const kind of ["", "Goods", "other"]) {
    assert.throws(() => normalizeProductPreset({ ...base, kind: kind as "goods" }, today),
      (error: unknown) => issueOf(error) === "kind must be goods or service", kind)
  }
})

void test("keeps a GTIN barcode as text with its leading zeros, and refuses a wrong check digit or length", () => {
  const base = { ...product, description: "Carte", unitPrice: "10", unitOfMeasure: each }
  for (const barcode of ["96385074", "036000291452", "4006381333931", "0036000291452", "00012345600012", "10614141000415"]) {
    assert.equal(normalizeProductPreset({ ...base, barcode }, today).barcode, barcode)
  }
  for (const barcode of ["4006381333932", "96385075", "123456789", "12345678901", "123456789012345", "400638133393a", " 4006381333931", "４006381333931", ""]) {
    assert.throws(() => normalizeProductPreset({ ...base, barcode }, today),
      (error: unknown) => issueOf(error) === "barcode must be a GTIN-8, 12, 13 or 14 with a valid check digit", barcode)
  }
  assert.equal(Object.hasOwn(normalizeProductPreset(base, today), "barcode"), false)
})

void test("a taken code is a conflict that names the code it was given", () => {
  const conflict = codeTakenConflict("CONS-1")
  assert.equal(conflict instanceof DomainConflict, true)
  assert.equal(conflict.code, productPresetCodeTaken)
  assert.equal(conflict.message, "Codul CONS-1 e deja folosit.")
})
