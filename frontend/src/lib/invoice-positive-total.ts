import type { EditableInvoiceLine } from "./invoice-authoring-model.ts"
import { compareDecimal, divideHalfUp, parseUnsignedDecimal } from "./money.ts"

const nonNegativeScaled = (value: string, scale: number): bigint | undefined => {
  const parsed = parseUnsignedDecimal(value.trim(), scale)
  return parsed.ok ? parsed.units : undefined
}

/**
 * Whether issuing this document needs a due date: only a total that rounds
 * positive does. The answer prefers the server's own total when the draft is
 * synchronized — the backend rounds each nonnegative line net to cents,
 * half-up, and a nonnegative VAT cannot turn a zero base positive — and falls
 * back to the same rounding over the edited lines otherwise. A draft may be
 * saved without one either way; the requirement binds only issuance.
 */
export const positiveInvoiceRequiresDueDate = (
  dueDate: string | null,
  totalIncludingVat: string | undefined,
  lines: ReadonlyArray<Pick<EditableInvoiceLine, "quantity" | "unitPrice">> = [],
): boolean => {
  if (dueDate !== null && dueDate !== "") return false
  // The server's total is read at whatever precision it carries, so "0.001" is positive.
  const sign = totalIncludingVat === undefined ? undefined : compareDecimal(totalIncludingVat.trim(), "0")
  if (sign !== undefined) return sign > 0
  return lines.some((line) => {
    const quantity = nonNegativeScaled(line.quantity, 4)
    const unitPrice = nonNegativeScaled(line.unitPrice, 2)
    return quantity !== undefined
      && unitPrice !== undefined
      && divideHalfUp(quantity * unitPrice, 10_000n) > 0n
  })
}
