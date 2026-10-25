import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { calculateLine, calculateTotals, normalizeMoney, validateFiscalDocument } from "./calculation.ts"
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

const issuesOf = (run: () => unknown): ReadonlyArray<string> => {
  try { run() } catch (error) {
    assert.ok(error instanceof ValidationFailure)
    return error.issues
  }
  return []
}
const lineWith = (quantity: string, unitPrice: string, rate = "21.00") => calculateLine({
  id: "line-1", description: "Servicii", quantity, unitPrice, unitOfMeasure: each, vat: tax("RO_STANDARD", rate),
})

void test("reads quantity and price trimmed, unsigned and padded to their scale, naming the field it refuses", () => {
  const read = lineWith(" 007.5 ", "0010")
  assert.deepEqual([read.quantity, read.unitPrice, read.totalExcludingVat], ["7.5000", "10.00", "75.00"])
  for (const value of ["-1", "+1", "abc", "", ".5", "5.", "1e2", "1,5", "1 000"]) {
    assert.deepEqual(issuesOf(() => lineWith(value, "1.00")), ["quantity must be a non-negative decimal"], value)
    assert.deepEqual(issuesOf(() => lineWith("1", value)), ["unitPrice must be a non-negative decimal"], value)
  }
  assert.deepEqual(issuesOf(() => lineWith("1.00001", "1.00")), ["quantity supports at most 4 decimal places"])
  assert.deepEqual(issuesOf(() => lineWith("1", "1.001")), ["unitPrice supports at most 2 decimal places"])
  assert.deepEqual(issuesOf(() => lineWith("0.0000", "1.00")), ["quantity must be greater than zero"])
  assert.deepEqual(lineWith("1", "0").totalIncludingVat, "0.00")
})

void test("rounds line net and VAT half up: just below, at and just above the half cent", () => {
  // quantity × price in millionths of a leu: 0.4999 × 0.01 = 0.004999, 0.5 × 0.01 = 0.005.
  assert.deepEqual(["0.4999", "0.5000", "0.5001"].map((quantity) => lineWith(quantity, "0.01").totalExcludingVat), ["0.00", "0.01", "0.01"])
  // 0.01 at 49.99%, 50% and 50.01% is 0.004999, 0.005 and 0.005001.
  assert.deepEqual(["49.99", "50.00", "50.01"].map((rate) => lineWith("1", "0.01", rate).vatAmount), ["0.00", "0.01", "0.01"])
  assert.deepEqual(["0.49", "0.50", "0.55"].map((price) => lineWith("1", price).vatAmount), ["0.10", "0.11", "0.12"])
})

void test("normalizes money to two decimals, trimmed, unsigned, with the caller's field name", () => {
  assert.equal(normalizeMoney(" 12.5 "), "12.50")
  assert.equal(normalizeMoney("0"), "0.00")
  assert.equal(normalizeMoney("00012.30"), "12.30")
  assert.equal(normalizeMoney("90071992547409.93"), "90071992547409.93")
  assert.deepEqual(issuesOf(() => normalizeMoney("-1.00")), ["money must be a non-negative decimal"])
  assert.deepEqual(issuesOf(() => normalizeMoney("1.234", "amount")), ["amount supports at most 2 decimal places"])
})

void test("reads a configured rate by its grammar and range, not by its number", () => {
  for (const rate of ["0.01", "1", "9.5", "21", "21.00", "99.99", "100", "100.00"]) {
    assert.doesNotThrow(() => { validateVatTreatment("RO_STANDARD", rate, "S", null) }, rate)
  }
  for (const rate of ["0", "0.00", "100.01", "100.5", "101", "021", "21.000", " 21", "21 ", "+21", "-21", "1e1", ".5", "21.", ""]) {
    assert.deepEqual(issuesOf(() => { validateVatTreatment("RO_STANDARD", rate, "S", null) }), ["Invalid VAT tuple"], rate)
  }
  for (const rate of ["0", "0.0", "0.00"]) {
    assert.doesNotThrow(() => { validateVatTreatment("RO_NON_VAT", rate, "O", article310VatExemptionReason) }, rate)
  }
  for (const rate of ["0.01", "00", "-0"]) {
    assert.deepEqual(issuesOf(() => { validateVatTreatment("RO_NON_VAT", rate, "O", article310VatExemptionReason) }), ["Invalid VAT tuple"], rate)
  }
})

void test("a calculated line carries the item identifiers it is given, checked, and nothing when it is given none", () => {
  const base = { id: "l-1", description: "Șurub", quantity: "1", unitPrice: "10", unitOfMeasure: { code: "C62", name: "unitate" },
    vat: { code: "RO_STANDARD", rate: "21.00", vatCategoryCode: "S" as const, vatExemptionReason: null, effectiveFrom: "2025-08-01" } }
  const line = calculateLine({ ...base, itemCode: "  SRB-1  ", barcode: "0012345678905" })
  assert.equal(line.itemCode, "SRB-1")
  assert.equal(line.barcode, "0012345678905")
  const plain = calculateLine(base)
  assert.equal(Object.hasOwn(plain, "itemCode") || Object.hasOwn(plain, "barcode"), false)
  assert.throws(() => calculateLine({ ...base, barcode: "0012345678906" }), ValidationFailure)
  assert.throws(() => calculateLine({ ...base, itemCode: "\u0000" }), ValidationFailure)
  // Totals do not depend on them: the same line with or without identifiers adds up the same.
  assert.deepEqual(calculateTotals([line]), calculateTotals([plain]))
})
