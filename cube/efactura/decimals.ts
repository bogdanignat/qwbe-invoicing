/**
 * Exact decimal handling for the amounts the generator renders.
 *
 * Snapshot amounts arrive as decimal strings and must be compared exactly:
 * binary floating point would make a one-cent VAT discrepancy invisible here
 * and visible at ANAF. Everything is scaled into integers instead.
 *
 * The invoicing cube has equivalent helpers, but cubes may not import each
 * other, so this is a deliberate re-statement of the same arithmetic rather
 * than shared code.
 */

/** Parses a non-negative decimal into a scaled integer, or records why not. */
export const scaled = (value: string, scale: number, field: string, issues: Array<string>): bigint | null => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (match === null) {
    issues.push(`${field} must be a non-negative decimal string, got "${value}"`)
    return null
  }
  const fraction = match[2] ?? ""
  if (fraction.length > scale) {
    issues.push(`${field} carries more than ${String(scale)} decimal places`)
    return null
  }
  return BigInt(match[1] ?? "0") * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0")
}

/** Amounts are always two decimal places in RON. */
export const money = (value: string, field: string, issues: Array<string>): bigint | null =>
  scaled(value, 2, field, issues)

/** Parses an amount for a cross-check whose parse errors are reported
 * elsewhere, so a malformed value skips the check instead of being named
 * twice in the same refusal. */
export const amountOrSkip = (value: string): bigint | null => money(value, "", [])

export const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number) as [number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** XSLT `normalize-space`: collapse internal whitespace runs, then trim. The
 * RO rules measure BT-120 after this transform (BR-RO-L100), so a length check
 * on the raw string would disagree with the validator. */
export const normalizeSpace = (value: string): string => value.replace(/\s+/gu, " ").trim()
