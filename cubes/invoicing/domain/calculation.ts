import { ValidationFailure } from "../contracts/failures.ts"
import { divideHalfUp, formatDecimal, parseUnsignedDecimal } from "../contracts/money.ts"
import type { DraftInvoice, DraftLine, ItemIdentifiers, VatBreakdown, VatConfiguration } from "./invoice.ts"
import { normalizeUnitOfMeasure, type UnitOfMeasure } from "./unit-of-measures.ts"
import { itemIdentifiers } from "../items/index.ts"
import { validateVatTreatment } from "./validation.ts"

const parseScaled = (value: string, scale: number, field: string): bigint => {
  const parsed = parseUnsignedDecimal(value.trim(), scale)
  if (parsed.ok) return parsed.units
  throw new ValidationFailure({ issues: [parsed.reason === "syntax"
    ? `${field} must be a non-negative decimal`
    : `${field} supports at most ${String(scale)} decimal places`] })
}

export const normalizeMoney = (value: string, field = "money"): string =>
  formatDecimal(parseScaled(value, 2, field), 2)

export const calculateLine = (input: ItemIdentifiers & {
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
    quantity: formatDecimal(quantity, 4),
    unitPrice: formatDecimal(unitPrice, 2),
    unitOfMeasure: normalizeUnitOfMeasure(input.unitOfMeasure),
    vatRateCode: input.vat.code,
    vatRate: formatDecimal(vatRate, 2),
    vatCategoryCode: input.vat.vatCategoryCode,
    vatExemptionReason: input.vat.vatExemptionReason,
    totalExcludingVat: formatDecimal(net, 2),
    vatAmount: formatDecimal(vat, 2),
    totalIncludingVat: formatDecimal(net + vat, 2),
    ...itemIdentifiers(input),
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
    // The zero beside O is a placeholder, so all O lines share one group.
    const key = line.vatCategoryCode === "O" ? "O" : `${line.vatCategoryCode}:${formatDecimal(parseScaled(line.vatRate, 2, "vatRate"), 2)}`
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
      vatBaseAmount: formatDecimal(base, 2),
      vatAmount: formatDecimal(vat, 2),
    }
  })
  return {
    totalExcludingVat: formatDecimal(totalExcludingVat, 2),
    vatTotal: formatDecimal(vatTotal, 2),
    totalIncludingVat: formatDecimal(totalExcludingVat + vatTotal, 2),
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
