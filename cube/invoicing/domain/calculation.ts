import { ValidationFailure } from "../contracts/failures.ts"
import type { DraftInvoice, DraftLine, VatBreakdown, VatConfiguration } from "./invoice.ts"
import { normalizeUnitOfMeasure, type UnitOfMeasure } from "./unit-of-measures.ts"
import { validateVatTreatment } from "./validation.ts"

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
  validateVatTreatment(input.vat.code, input.vat.rate, input.vat.vatCategoryCode, input.vat.vatExemptionReason)
  if (input.description.trim().length === 0) throw new ValidationFailure({ issues: ["description is required"] })
  const quantity = parseScaled(input.quantity, 4, "quantity")
  const unitPrice = parseScaled(input.unitPrice, 2, "unitPrice")
  const vatRate = parseScaled(input.vat.rate, 2, "vatRate")
  if (quantity === 0n) throw new ValidationFailure({ issues: ["quantity must be greater than zero"] })
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
    vatCategoryCode: input.vat.vatCategoryCode,
    vatExemptionReason: input.vat.vatExemptionReason,
    totalExcludingVat: formatScaled(net, 2),
    vatAmount: formatScaled(vat, 2),
    totalIncludingVat: formatScaled(net + vat, 2),
  }
}

const moneyToMinor = (value: string): bigint => parseScaled(value, 2, "money")
const mismatch = (message: string): never => { throw new ValidationFailure({ issues: [message] }) }
const lineValue = (line: DraftLine): string => `${line.totalExcludingVat}|${line.vatAmount}|${line.totalIncludingVat}`

export const calculateTotals = (lines: ReadonlyArray<DraftLine>) => {
  const groups = new Map<string, { line: DraftLine; base: bigint }>()
  let totalExcludingVat = 0n
  for (const line of lines) {
    const checked = calculateLine({ ...line, vat: { code: line.vatRateCode, rate: line.vatRate,
      vatCategoryCode: line.vatCategoryCode, vatExemptionReason: line.vatExemptionReason, effectiveFrom: "0000-01-01" } })
    if (lineValue(line) !== lineValue(checked)) mismatch("line totals are inconsistent")
    const base = moneyToMinor(line.totalExcludingVat)
    totalExcludingVat += base
    const key = line.vatCategoryCode === "E" ? "E" : `${line.vatCategoryCode}:${formatScaled(parseScaled(line.vatRate, 2, "vatRate"), 2)}`
    const current = groups.get(key)
    if (current !== undefined && (current.line.vatRateCode !== line.vatRateCode
      || current.line.vatExemptionReason !== line.vatExemptionReason)) {
      throw new ValidationFailure({ issues: [`VAT group ${key} contains inconsistent code or exemption reason`] })
    }
    groups.set(key, { line, base: (current?.base ?? 0n) + base })
  }
  let vatTotal = 0n
  const vatBreakdown: ReadonlyArray<VatBreakdown> = [...groups.values()].map(({ line, base }) => {
    const vat = divideHalfUp(base * parseScaled(line.vatRate, 2, "vatRate"), 10_000n)
    vatTotal += vat
    return {
      code: line.vatRateCode,
      rate: line.vatRate,
      vatCategoryCode: line.vatCategoryCode,
      vatExemptionReason: line.vatExemptionReason,
      vatBaseAmount: formatScaled(base, 2),
      vatAmount: formatScaled(vat, 2),
    }
  })
  return {
    totalExcludingVat: formatScaled(totalExcludingVat, 2),
    vatTotal: formatScaled(vatTotal, 2),
    totalIncludingVat: formatScaled(totalExcludingVat + vatTotal, 2),
    vatBreakdown,
  }
}

type FiscalDocument = Pick<DraftInvoice, "lines" | "vatBreakdown" | "totalExcludingVat" | "vatTotal" | "totalIncludingVat">
const breakdownValue = ({ code, rate, vatCategoryCode, vatExemptionReason, vatBaseAmount, vatAmount }: VatBreakdown): string =>
  JSON.stringify([code, rate, vatCategoryCode, vatExemptionReason, vatBaseAmount, vatAmount])

export const validateFiscalDocument = (document: FiscalDocument): void => {
  if (document.lines.length === 0) mismatch("document must contain at least one line")
  const expected = calculateTotals(document.lines)
  const value = (document: Omit<FiscalDocument, "lines">): string => JSON.stringify([document.totalExcludingVat,
    document.vatTotal, document.totalIncludingVat, document.vatBreakdown.map(breakdownValue).sort()])
  if (value(document) !== value(expected)) mismatch("document totals are inconsistent")
}
