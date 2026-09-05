import { ValidationFailure } from "../contracts/failures.ts"
import type { DraftLine, VatBreakdown, VatConfiguration } from "./invoice.ts"
import { normalizeUnitOfMeasure, type UnitOfMeasure } from "./unit-of-measures.ts"

const parseScaled = (value: string, scale: number, field: string): bigint => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (match === null) throw new ValidationFailure({ issues: [`${field} must be a non-negative decimal`] })
  const fraction = match[2] ?? ""
  if (fraction.length > scale) {
    throw new ValidationFailure({ issues: [`${field} supports at most ${String(scale)} decimal places`] })
  }
  return BigInt(match[1] ?? "0") * 10n ** BigInt(scale)
    + BigInt(fraction.padEnd(scale, "0") || "0")
}

const divideHalfUp = (numerator: bigint, denominator: bigint): bigint =>
  (numerator + denominator / 2n) / denominator

const formatScaled = (value: bigint, scale: number): string => {
  const divisor = 10n ** BigInt(scale)
  const whole = value / divisor
  const fraction = (value % divisor).toString().padStart(scale, "0")
  return scale === 0 ? whole.toString() : `${whole.toString()}.${fraction}`
}

export const normalizeMoney = (value: string, field = "money"): string =>
  formatScaled(parseScaled(value, 2, field), 2)

export const calculateLine = (input: {
  readonly id: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vat: VatConfiguration
}): DraftLine => {
  if (input.description.trim().length === 0) throw new ValidationFailure({ issues: ["description is required"] })
  const quantity = parseScaled(input.quantity, 4, "quantity")
  const unitPrice = parseScaled(input.unitPrice, 2, "unitPrice")
  const vatRate = parseScaled(input.vat.rate, 2, "vatRate")
  if (quantity === 0n) throw new ValidationFailure({ issues: ["quantity must be greater than zero"] })
  if (vatRate > 10_000n) throw new ValidationFailure({ issues: ["vatRate cannot exceed 100.00"] })

  const net = divideHalfUp(quantity * unitPrice, 10_000n)
  const vat = divideHalfUp(net * vatRate, 10_000n)
  return {
    id: input.id,
    description: input.description.trim(),
    quantity: formatScaled(quantity, 4),
    unitPrice: formatScaled(unitPrice, 2),
    unitOfMeasure: normalizeUnitOfMeasure(input.unitOfMeasure),
    vatRateCode: input.vat.code,
    vatRate: formatScaled(vatRate, 2),
    totalExcludingVat: formatScaled(net, 2),
    vatAmount: formatScaled(vat, 2),
    totalIncludingVat: formatScaled(net + vat, 2),
  }
}

const moneyToMinor = (value: string): bigint => parseScaled(value, 2, "money")

export const calculateTotals = (lines: ReadonlyArray<DraftLine>) => {
  const groups = new Map<string, { line: DraftLine; base: bigint; vat: bigint }>()
  let totalExcludingVat = 0n
  let vatTotal = 0n
  for (const line of lines) {
    const base = moneyToMinor(line.totalExcludingVat)
    const vat = moneyToMinor(line.vatAmount)
    totalExcludingVat += base
    vatTotal += vat
    const key = `${line.vatRateCode}:${line.vatRate}`
    const current = groups.get(key)
    groups.set(key, {
      line,
      base: (current?.base ?? 0n) + base,
      vat: (current?.vat ?? 0n) + vat,
    })
  }
  const vatBreakdown: ReadonlyArray<VatBreakdown> = [...groups.values()].map(({ line, base, vat }) => ({
    code: line.vatRateCode,
    rate: line.vatRate,
    vatBaseAmount: formatScaled(base, 2),
    vatAmount: formatScaled(vat, 2),
  }))
  return {
    totalExcludingVat: formatScaled(totalExcludingVat, 2),
    vatTotal: formatScaled(vatTotal, 2),
    totalIncludingVat: formatScaled(totalExcludingVat + vatTotal, 2),
    vatBreakdown,
  }
}
