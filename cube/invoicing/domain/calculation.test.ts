import assert from "node:assert/strict"
import test from "node:test"

import { ValidationFailure } from "../contracts/failures.ts"
import { calculateLine, calculateTotals } from "./calculation.ts"
const each = { code: "C62", name: "unitate" } as const

const tax = (code: string, rate: string) => ({
  code,

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
    totalExcludingVat: "12.36",
    vatAmount: "2.60",
    totalIncludingVat: "14.96",
  })
  assert.deepEqual(calculateTotals([first, second]), {
    totalExcludingVat: "12.46",
    vatTotal: "2.61",
    totalIncludingVat: "15.07",
    vatBreakdown: [
      { code: "RO_STANDARD", rate: "21.00", vatBaseAmount: "12.36", vatAmount: "2.60" },
      { code: "RO_REDUCED", rate: "9.00", vatBaseAmount: "0.10", vatAmount: "0.01" },
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
