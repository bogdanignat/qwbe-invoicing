import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { calculateLine, calculateTotals, validateFiscalDocument } from "./calculation.ts"
import { article310VatExemptionReason, validateVatTreatment } from "./validation.ts"
const each = { code: "C62", name: "unitate" } as const

const tax = (code: string, rate: string) => ({
  code,
  rate,
  vatCategoryCode: "S" as const,
  vatExemptionReason: null,
  effectiveFrom: "2025-08-01",
})

void test("calculates quantity, configured VAT, grouped breakdown, and totals with integer half-up arithmetic", () => {
  const first = calculateLine({
    id: "line-1",
    description: "Servicii",
    quantity: "1.2345",
    unitPrice: "10.01",
    unitOfMeasure: each,
    vat: tax("RO_STANDARD", "21"),
  })
  const second = calculateLine({
    id: "line-2",
    description: "Licență",
    quantity: "2",
    unitPrice: "0.05",
    unitOfMeasure: each,
    vat: tax("RO_REDUCED", "9"),
  })

  assert.deepEqual(first, {
    id: "line-1",
    description: "Servicii",
    quantity: "1.2345",
    unitPrice: "10.01",
    unitOfMeasure: each,
    vatRateCode: "RO_STANDARD",

    vatRate: "21.00",
    vatCategoryCode: "S",
    vatExemptionReason: null,
    totalExcludingVat: "12.36",
    vatAmount: "2.60",
    totalIncludingVat: "14.96",
  })
  assert.deepEqual(calculateTotals([first, second]), {
    totalExcludingVat: "12.46",
    vatTotal: "2.61",
    totalIncludingVat: "15.07",
    vatBreakdown: [
      { code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "12.36", vatAmount: "2.60" },
      { code: "RO_REDUCED", rate: "9.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "0.10", vatAmount: "0.01" },
    ],
  })
})

void test("computes category VAT from the summed base, not from the rounded line amounts (EN 16931 BR-CO-17)", () => {
  // Three lines of 1.11 at 21%: each line rounds 0.2331 to 0.23, so the line sum is 0.69,
  // while the category owes round(3.33 × 21%) = round(0.6993) = 0.70.
  const lines = [1, 2, 3].map((index) => calculateLine({
    id: `line-${String(index)}`,
    description: "Serviciu",
    quantity: "1",
    unitPrice: "1.11",
    unitOfMeasure: each,
    vat: tax("RO_STANDARD", "21.00"),
  }))
  assert.deepEqual(lines.map((line) => line.vatAmount), ["0.23", "0.23", "0.23"])
  assert.deepEqual(calculateTotals(lines), {
    totalExcludingVat: "3.33",
    vatTotal: "0.70",
    totalIncludingVat: "4.03",
    vatBreakdown: [{ code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S", vatExemptionReason: null, vatBaseAmount: "3.33", vatAmount: "0.70" }],
  })
})

void test("groups article 310 lines into one O breakdown and validates the complete positive snapshot", () => {
  const vat = { code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O" as const,
    vatExemptionReason: article310VatExemptionReason, effectiveFrom: "2025-08-01" }
  const lines = ["10", "0"].map((unitPrice, index) => calculateLine({ id: `e-${String(index)}`, description: "Serviciu",
    quantity: "1", unitPrice, unitOfMeasure: each, vat }))
  const document = { lines, ...calculateTotals(lines) }
  assert.deepEqual(document.vatBreakdown, [{ code: "RO_NON_VAT", rate: "0.00", vatCategoryCode: "O",
    vatExemptionReason: article310VatExemptionReason, vatBaseAmount: "10.00", vatAmount: "0.00" }])
  assert.doesNotThrow(() => { validateFiscalDocument(document) })
  assert.throws(() => { validateFiscalDocument({ ...document,
    vatBreakdown: [{ ...document.vatBreakdown[0] as NonNullable<typeof document.vatBreakdown[0]>, vatBaseAmount: "9.99" }] }) }, ValidationFailure)
  assert.throws(() => { calculateTotals(lines.map((line, index) => index === 0 ? { ...line, vatRateCode: "RO_STANDARD" } : line)) }, ValidationFailure)
})

void test("rejects excess precision and impossible configured rates instead of rounding input", () => {
  assert.throws(
    () => calculateLine({
      id: "line-1",
      description: "Servicii",
      quantity: "1.00001",
      unitPrice: "10.00",
      unitOfMeasure: each,
      vat: tax("RO_STANDARD", "21.00"),
    }),
    (error: unknown) => error instanceof ValidationFailure,
  )
  assert.throws(
    () => calculateLine({
      id: "line-1",
      description: "Servicii",
      quantity: "1",
      unitPrice: "10.00",
      unitOfMeasure: each,
      vat: tax("INVALID", "100.01"),
    }),
    (error: unknown) => error instanceof ValidationFailure,
  )
})

void test("accepts only canonical S and explicit article 310 O treatment tuples", () => {
  assert.doesNotThrow(() => { validateVatTreatment("RO_STANDARD", "21.00", "S", null) })
  assert.doesNotThrow(() => { validateVatTreatment("RO_NON_VAT", "0.00", "O", article310VatExemptionReason) })
  for (const tuple of [
    ["RO_STANDARD", "21.00", "S", article310VatExemptionReason],
    ["RO_STANDARD", "0.00", "S", null], ["RO_NON_VAT", "0.00", "O", null], ["OTHER", "21.00", "S", null],
    // `E` is not a treatment this product issues: the exempt category belongs to
    // cases we do not sell, so the exact article 310 tuple is refused under it.
    ["RO_NON_VAT", "0.00", "E", article310VatExemptionReason], ["RO_NON_VAT", "0.00", "", article310VatExemptionReason],
    ["RO_NON_VAT", "21.00", "O", article310VatExemptionReason], ["RO_NON_VAT", "0.00", "O", "Scutit"],
  ] satisfies ReadonlyArray<readonly [string, string, string, string | null]>) {
    assert.throws(() => { validateVatTreatment(tuple[0], tuple[1], tuple[2], tuple[3]) }, ValidationFailure)
  }
})
