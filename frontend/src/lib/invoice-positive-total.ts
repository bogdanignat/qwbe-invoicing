import type { EditableInvoiceLine } from "./invoice-authoring-model.ts"

const decimal = (value: string): number | undefined => {
  const trimmed = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

const nonNegativeScaled = (value: string, scale: number): bigint | undefined => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (match === null || (match[2]?.length ?? 0) > scale) return undefined
  return BigInt(match[1] ?? "0") * 10n ** BigInt(scale)
    + BigInt((match[2] ?? "").padEnd(scale, "0"))
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
  const total = totalIncludingVat === undefined ? undefined : decimal(totalIncludingVat)
  if (total !== undefined) return total > 0
  return lines.some((line) => {
    const quantity = nonNegativeScaled(line.quantity, 4)
    const unitPrice = nonNegativeScaled(line.unitPrice, 2)
    return quantity !== undefined
      && unitPrice !== undefined
      && (quantity * unitPrice + 5_000n) / 10_000n > 0n
  })
}
