import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_UNIT_CODE, newProductPresetForm, productPresetFormOf, productPresetPayload,
} from "./product-preset-form.ts"
import type { ProductPreset, UnitOfMeasure, VatRate } from "./draft-models.ts"

const units: ReadonlyArray<UnitOfMeasure> = [
  { code: "H87", name: "bucată" }, { code: DEFAULT_UNIT_CODE, name: "unitate" }, { code: "KGM", name: "kilogram" },
]
const rates: ReadonlyArray<VatRate> = [
  { code: "RO_STANDARD", rate: "21.00", kind: "standard", label: "TVA standard 21%", vatCategoryCode: "S", vatExemptionReason: null, effectiveFrom: "2025-08-01" },
]
const preset: ProductPreset = {
  id: "prs_1", organizationId: "org_1", code: "CONS-1", kind: "service", description: "Consultanță", unitPrice: "100.50",
  unitOfMeasure: { code: "KGM", name: "kilogram" }, preferredVatRateCode: "RO_STANDARD", barcode: "00012345600012",
}
const form = productPresetFormOf(preset)

void test("a new product opens on the piece unit, or on whatever the catalogue has", () => {
  assert.equal(newProductPresetForm(units).unitOfMeasureCode, DEFAULT_UNIT_CODE)
  assert.equal(newProductPresetForm([{ code: "H87", name: "bucată" }]).unitOfMeasureCode, "H87")
  assert.equal(newProductPresetForm([]).unitOfMeasureCode, "")
  assert.deepEqual(newProductPresetForm(units), {
    code: "", kind: "goods", description: "", unitOfMeasureCode: DEFAULT_UNIT_CODE, unitPrice: "",
    preferredVatRateCode: "", barcode: "",
  })
})

void test("editing an existing product starts from what was saved", () => {
  assert.deepEqual(form, {
    code: "CONS-1", kind: "service", description: "Consultanță", unitOfMeasureCode: "KGM", unitPrice: "100.50",
    preferredVatRateCode: "RO_STANDARD", barcode: "00012345600012",
  })
  // No preference is the empty option, never a code.
  assert.equal(productPresetFormOf({
    id: "prs_2", organizationId: "org_1", code: "TR", kind: "service", description: "Transport", unitPrice: "20.00",
    unitOfMeasure: { code: "KGM", name: "kilogram" },
  }).preferredVatRateCode, "")
})

void test("the payload carries the unit itself, a dot-decimal price and no empty preference", () => {
  const ready = productPresetPayload({ ...form, code: " CONS-1 ", description: "  Consultanță  ", unitPrice: " 4,50 " }, units, rates)
  assert.deepEqual(ready, {
    kind: "ready",
    payload: {
      code: "CONS-1", kind: "service",
      description: "Consultanță", unitPrice: "4.50", unitOfMeasure: { code: "KGM", name: "kilogram" },
      preferredVatRateCode: "RO_STANDARD", barcode: "00012345600012",
    },
  })
  const noPreference = productPresetPayload({ ...form, preferredVatRateCode: "" }, units, rates)
  assert.equal(noPreference.kind === "ready" && "preferredVatRateCode" in noPreference.payload, false)
})

void test("each rule names the field that refuses, reading down the form", () => {
  const refusals = [
    [{ code: "  " }, "code"],
    [{ code: "x".repeat(51) }, "code"],
    [{ code: "ȘURUB" }, "code"],
    [{ code: "café" }, "code"],
    [{ description: " " }, "description"],
    [{ description: "x", unitOfMeasureCode: "XXX" }, "unitOfMeasure"],
    [{ unitPrice: "" }, "unitPrice"],
    [{ unitPrice: "12.345" }, "unitPrice"],
    [{ unitPrice: "-1" }, "unitPrice"],
    [{ unitPrice: "abc" }, "unitPrice"],
    [{ preferredVatRateCode: "RO_REDUCED_5" }, "preferredVatRateCode"],
    [{ barcode: "4006381333932" }, "barcode"],
    [{ barcode: "123456789" }, "barcode"],
    [{ barcode: "96385075" }, "barcode"],
  ] as const
  for (const [patch, field] of refusals) {
    const validation = productPresetPayload({ ...form, ...patch }, units, rates)
    assert.equal(validation.kind, "issue", JSON.stringify(patch))
    assert.equal(validation.field, field, JSON.stringify(patch))
    assert.notEqual(validation.message, "")
  }
  // Both a dot and a comma are accepted; the payload is normalized to the dot.
  for (const unitPrice of ["0", "0.5", "10", "10,25"]) {
    assert.equal(productPresetPayload({ ...form, unitPrice }, units, rates).kind, "ready")
  }
})

void test("the EAN stays text with its leading zeros, and clearing it on an edit removes it from the product", () => {
  const kept = productPresetPayload({ ...form, barcode: " 0036000291452 " }, units, rates)
  assert.equal(kept.kind === "ready" ? kept.payload.barcode : undefined, "0036000291452")
  const cleared = productPresetPayload({ ...form, barcode: "" }, units, rates)
  assert.equal(cleared.kind === "ready" && "barcode" in cleared.payload, false)
  // The code keeps its own case, its signs and its inner spaces; the server decides uniqueness.
  const signs = productPresetPayload({ ...form, code: " SRB/M6 #1 (v2.0) " }, units, rates)
  assert.equal(signs.kind === "ready" ? signs.payload.code : undefined, "SRB/M6 #1 (v2.0)")
})

void test("a code with diacritics is refused at the code field, in Romanian", () => {
  const refused = productPresetPayload({ ...form, code: "ȘURUB" }, units, rates)
  assert.deepEqual(refused, { kind: "issue", field: "code", message: "Codul poate conține doar litere fără diacritice, cifre și semne obișnuite." })
  assert.deepEqual(productPresetPayload({ ...form, code: " " }, units, rates), { kind: "issue", field: "code", message: "Codul articolului este obligatoriu." })
})
