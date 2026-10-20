import { formatDecimal, isCanonicalDecimal, parseDecimal } from "../../cubes/invoicing/contracts/money.ts"
import type { Row } from "./postgres-rows.ts"

/**
 * Money at the PostgreSQL boundary. The domain and the API speak decimal strings
 * with exactly two places ("123.45", "-0.05"); the columns are BIGINT in bani
 * (12345, -5). This is the only conversion, in both directions, and it never
 * goes through `number`: it is digit work plus `BigInt`, so a value past 2^53
 * survives exactly.
 *
 * The writer is strict on purpose — canonical form only, no whitespace,
 * exponent or rounding — because the domain already normalised the amount and
 * anything else reaching storage is a defect. The range is not checked here:
 * PostgreSQL refuses a value past int8 with 22003, which the adapters map to a
 * conflict. `pg` hands int8 back as a string and no global type parser is
 * installed, so the reader takes exactly that string.
 */

const minorUnits = /^-?\d+$/u

/** Canonical up to the sign, so "-0.00" is read as zero too. */
const canonicalMinor = (amount: string): bigint | undefined => {
  const parsed = parseDecimal(amount, 2)
  return parsed.ok && isCanonicalDecimal(amount.replace(/^-/u, ""), 2) ? parsed.units : undefined
}

/** "123.45" -> "12345", "-0.05" -> "-5", "-0.00" -> "0": the bound int8 value. */
export const moneyValue = (amount: string): string => {
  const minor = canonicalMinor(amount)
  if (minor === undefined) throw new Error(`invalid money amount ${JSON.stringify(amount)}`)
  return minor.toString()
}

/** "12345" -> "123.45", "-5" -> "-0.05": the decimal the domain expects. */
export const moneyFrom = (minor: string): string => {
  if (!minorUnits.test(minor)) throw new Error(`invalid money minor units ${JSON.stringify(minor)}`)
  return formatDecimal(BigInt(minor), 2)
}

/** A NOT NULL money column of a row. */
export const money = (value: Row, field: string): string => {
  const result = value[field]
  if (typeof result !== "string") throw new Error(`invalid ${field}`)
  return moneyFrom(result)
}

/**
 * The optional social capital: "" in the domain is SQL NULL, and "0.00" is a
 * real zero, distinct from absence.
 */
export const optionalMoneyValue = (amount: string): string | null => amount === "" ? null : moneyValue(amount)

/** Only NULL reads as absent; a missing field is a defect, not an absence. */
export const optionalMoney = (value: Row, field: string): string => value[field] === null ? "" : money(value, field)
