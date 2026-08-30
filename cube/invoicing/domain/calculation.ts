import { ValidationFailure } from "../contracts/failures.ts"
import type { DraftLine, TaxBreakdown, TaxConfiguration } from "./invoice.ts"

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

export const calculateLine = (input: {
  readonly id: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly tax: TaxConfiguration
}): DraftLine => {
  if (input.description.trim().length === 0) throw new ValidationFailure({ issues: ["description is required"] })
  const quantity = parseScaled(input.quantity, 4, "quantity")
  const unitPrice = parseScaled(input.unitPrice, 2, "unitPrice")
  const taxRate = parseScaled(input.tax.rate, 2, "taxRate")
  if (quantity === 0n) throw new ValidationFailure({ issues: ["quantity must be greater than zero"] })
  if (taxRate > 10_000n) throw new ValidationFailure({ issues: ["taxRate cannot exceed 100.00"] })

  const net = divideHalfUp(quantity * unitPrice, 10_000n)
  const tax = divideHalfUp(net * taxRate, 10_000n)
  return {
    id: input.id,
    description: input.description.trim(),
    quantity: formatScaled(quantity, 4),
    unitPrice: formatScaled(unitPrice, 2),
    taxCode: input.tax.code,
    taxCategory: input.tax.category,
    taxRate: formatScaled(taxRate, 2),
    totalExcludingTax: formatScaled(net, 2),
    taxAmount: formatScaled(tax, 2),
    totalIncludingTax: formatScaled(net + tax, 2),
  }
}

const moneyToMinor = (value: string): bigint => parseScaled(value, 2, "money")

export const calculateTotals = (lines: ReadonlyArray<DraftLine>) => {
  const groups = new Map<string, { line: DraftLine; taxable: bigint; tax: bigint }>()
  let totalExcludingTax = 0n
  let taxTotal = 0n
  for (const line of lines) {
    const taxable = moneyToMinor(line.totalExcludingTax)
    const tax = moneyToMinor(line.taxAmount)
    totalExcludingTax += taxable
    taxTotal += tax
    const key = `${line.taxCode}:${line.taxCategory}:${line.taxRate}`
    const current = groups.get(key)
    groups.set(key, {
      line,
      taxable: (current?.taxable ?? 0n) + taxable,
      tax: (current?.tax ?? 0n) + tax,
    })
  }
  const taxBreakdown: ReadonlyArray<TaxBreakdown> = [...groups.values()].map(({ line, taxable, tax }) => ({
    taxCode: line.taxCode,
    category: line.taxCategory,
    rate: line.taxRate,
    taxableAmount: formatScaled(taxable, 2),
    taxAmount: formatScaled(tax, 2),
  }))
  return {
    totalExcludingTax: formatScaled(totalExcludingTax, 2),
    taxTotal: formatScaled(taxTotal, 2),
    totalIncludingTax: formatScaled(totalExcludingTax + taxTotal, 2),
    taxBreakdown,
  }
}
