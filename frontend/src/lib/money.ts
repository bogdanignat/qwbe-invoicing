/**
 * Money and quantities are decimal strings, scaled into `bigint` to compute:
 * `"12.34"` at scale 2 is `1234n`. Nothing goes through `number`, so a value past
 * 2^53 stays exact. These are the primitives only; whether a caller trims, allows
 * a sign, refuses zero or wants a canonical form is its own rule, next to it.
 * The browser cannot import the cube, so this mirrors cubes/invoicing/contracts/money.ts
 * line for line, and the labels at the end mirror the PDF's (kernel/documents/pdf-format.ts);
 * probes/frontend-cube-parity.test.mjs holds both equal.
 */
export type ParsedDecimal =
  | { readonly ok: true; readonly units: bigint }
  | { readonly ok: false; readonly reason: "syntax" | "precision" }

/** Digits, an optional fraction, an optional leading minus: no trim, `+`, exponent, `.5` or `5.`. */
const decimal = /^(-?)(\d+)(?:\.(\d+))?$/u

export const parseDecimal = (value: string, scale: number): ParsedDecimal => {
  const match = decimal.exec(value)
  if (match === null) return { ok: false, reason: "syntax" }
  const [, sign, whole = "", fraction = ""] = match
  if (fraction.length > scale) return { ok: false, reason: "precision" }
  const units = BigInt(`${whole}${fraction.padEnd(scale, "0")}`)
  return { ok: true, units: sign === "-" ? -units : units }
}

/** The same grammar without the sign: `"-0"` is a syntax fault here, not zero. */
export const parseUnsignedDecimal = (value: string, scale: number): ParsedDecimal =>
  value.startsWith("-") ? { ok: false, reason: "syntax" } : parseDecimal(value, scale)

/** `-1234n` at scale 2 is `"-12.34"`; zero is never signed. */
export const formatDecimal = (units: bigint, scale: number): string => {
  const sign = units < 0n ? "-" : ""
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, "0")
  const whole = digits.slice(0, digits.length - scale)
  return scale === 0 ? `${sign}${whole}` : `${sign}${whole}.${digits.slice(-scale)}`
}

/** Exactly what formatDecimal writes at that scale: "-02.50", "2.5" or "-0.00" are not canonical at scale 2. */
export const isCanonicalDecimal = (value: string, scale: number): boolean => {
  const parsed = parseDecimal(value, scale)
  return parsed.ok && formatDecimal(parsed.units, scale) === value
}

/** Integer division rounding the half away from zero: 5/10 is 1, -5/10 is -1. */
export const divideHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) throw new RangeError("divideHalfUp needs a positive denominator")
  const magnitude = (2n * (numerator < 0n ? -numerator : numerator) + denominator) / (2n * denominator)
  return numerator < 0n ? -magnitude : magnitude
}

const fractionDigits = (value: string): number => value.split(".")[1]?.length ?? 0

/** Compares two decimals by value at whatever precision they carry; `undefined` when either does not parse. */
export const compareDecimal = (left: string, right: string): -1 | 0 | 1 | undefined => {
  const scale = Math.max(fractionDigits(left), fractionDigits(right))
  const a = parseDecimal(left, scale)
  const b = parseDecimal(right, scale)
  if (!a.ok || !b.ok) return undefined
  return a.units < b.units ? -1 : a.units > b.units ? 1 : 0
}

/**
 * An amount for people: thousands grouped with a comma, a point before the
 * fraction and the scale it came with, so money keeps `.DD` and a quantity
 * `.DDDD` (`6,600.00`, `-1,250,000.00`, `4,800.0000`). Zero is never signed.
 * Text that is no decimal is shown as it came. Only labels go through here:
 * an input, a payload or a chart keeps the bare string. The PDF writes the same
 * (kernel/documents/pdf-format.ts, held equal by the parity probe).
 */
export const formatAmount = (value: string): string => {
  const scale = fractionDigits(value)
  const parsed = parseDecimal(value, scale)
  if (!parsed.ok) return value
  const [whole = "", fraction] = formatDecimal(parsed.units, scale).split(".")
  const grouped = whole.replace(/\B(?=(\d{3})+$)/gu, ",")
  return fraction === undefined ? grouped : `${grouped}.${fraction}`
}

/** A VAT rate, or a round axis value, without its idle zeros: `21.00` is `21`, `20.50` is `20.5`. */
export const formatRate = (rate: string): string =>
  formatAmount(rate.includes(".") ? rate.replace(/\.?0+$/u, "") : rate)

/** `money("6600.00", "RON")` is `6,600.00 RON`. */
export const money = (value: string, currency: string): string => `${formatAmount(value)} ${currency}`
