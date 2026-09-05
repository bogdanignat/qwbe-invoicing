import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { calculateLine, calculateTotals } from "./calculation.ts"
const each = { code: "C62", name: "unitate" } as const

const tax = (code: string, rate: string) => ({
  code,
  category: "standard" as const,
  rate,
  effectiveFrom: "2025-08-01",
})

void test("calculates quantity, configured VAT, grouped breakdown, and totals with integer half-up arithmetic", () => {
  const first = calculateLine({
    id: "line-1",
    description: "Servicii",
    quantity: "1.2345",
    unitPrice: "10.01",
    unitOfMeasure: each,
    tax: tax("RO_STANDARD", "21"),
  })
  const second = calculateLine({
    id: "line-2",
    description: "Licență",
    quantity: "2",
    unitPrice: "0.05",
    unitOfMeasure: each,
    tax: tax("RO_REDUCED", "9"),
  })

  assert.deepEqual(first, {
    id: "line-1",
    description: "Servicii",
    quantity: "1.2345",
    unitPrice: "10.01",
    unitOfMeasure: each,
    taxCode: "RO_STANDARD",
    taxCategory: "standard",
    taxRate: "21.00",
    totalExcludingTax: "12.36",
    taxAmount: "2.60",
    totalIncludingTax: "14.96",
  })
  assert.deepEqual(calculateTotals([first, second]), {
    totalExcludingTax: "12.46",
    taxTotal: "2.61",
    totalIncludingTax: "15.07",
    taxBreakdown: [
      { taxCode: "RO_STANDARD", category: "standard", rate: "21.00", taxableAmount: "12.36", taxAmount: "2.60" },
      { taxCode: "RO_REDUCED", category: "standard", rate: "9.00", taxableAmount: "0.10", taxAmount: "0.01" },
    ],
  })
})

void test("rejects excess precision and impossible configured rates instead of rounding input", () => {
  assert.throws(
    () => calculateLine({
      id: "line-1",
      description: "Servicii",
      quantity: "1.00001",
      unitPrice: "10.00",
      unitOfMeasure: each,
      tax: tax("RO_STANDARD", "21.00"),
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
      tax: tax("INVALID", "100.01"),
    }),
    (error: unknown) => error instanceof ValidationFailure,
  )
})
