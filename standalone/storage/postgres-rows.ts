import type {
  Address, BuyerSnapshot, PartySnapshot,
} from "../../cube/invoicing/index.ts"
import type { QueryValue } from "./postgres-sql.ts"

/**
 * Row decoding for the PostgreSQL adapters.
 *
 * What the driver hands back, and why each decoder looks the way it does
 * (driver probe g10, g11): `text` columns arrive as strings, `integer` (int4)
 * as numbers, and `bigint` (int8) as a STRING — `pg` refuses to lose precision
 * silently. No global type parser is installed, so the two session epochs are
 * decoded explicitly by `epoch` below and every other column keeps the driver's
 * own representation.
 *
 * Money and dates are TEXT on both engines, so they decode with `text`: exactly
 * the characters the writer bound, never a float.
 */

export type Row = Readonly<Record<string, unknown>>

export const row = (value: unknown): Row | undefined =>
  typeof value === "object" && value !== null ? value as Row : undefined

export const firstRow = (rows: ReadonlyArray<Row>): Row | undefined => rows.length === 0 ? undefined : rows[0]

export const text = (value: Row, field: string): string => {
  const result = value[field]
  if (typeof result !== "string") throw new Error(`invalid ${field}`)
  return result
}

export const optionalText = (value: Row, field: string): string | undefined => {
  const result = value[field]
  if (result === null || result === undefined) return undefined
  if (typeof result !== "string") throw new Error(`invalid ${field}`)
  return result
}

export const nullableText = (value: Row, field: string): string | null => optionalText(value, field) ?? null

export const integer = (value: Row, field: string): number => {
  const result = value[field]
  if (typeof result !== "number" || !Number.isInteger(result)) throw new Error(`invalid ${field}`)
  return result
}

export const booleanInteger = (value: Row, field: string): boolean => {
  const result = integer(value, field)
  if (result !== 0 && result !== 1) throw new Error(`invalid ${field}`)
  return result === 1
}

export const optionalInteger = (value: Row, field: string): number | undefined => {
  const result = value[field]
  if (result === null || result === undefined) return undefined
  if (typeof result !== "number" || !Number.isInteger(result)) throw new Error(`invalid ${field}`)
  return result
}

/**
 * An `int8` column, decoded on purpose rather than by a global parser: the
 * driver gives a string, and a value past 2^53 has no exact `number`. Out of
 * range throws instead of rounding — a session epoch that cannot be represented
 * is a defect, not a value to approximate.
 */
export const epoch = (value: Row, field: string): number => {
  const result = value[field]
  if (typeof result === "number" && Number.isSafeInteger(result)) return result
  if (typeof result !== "string" || !/^-?\d+$/u.test(result)) throw new Error(`invalid ${field}`)
  const parsed = Number(result)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} out of safe integer range: ${result}`)
  return parsed
}

/** A boolean bound back as the 0/1 integer the CHECK constraints expect. */
export const booleanValue = (value: boolean): number => value ? 1 : 0

export const addressFrom = (value: Row, prefix = ""): Address => {
  const county = text(value, `${prefix}county`)
  const sector = optionalInteger(value, `${prefix}sector`)
  const postalCode = optionalText(value, `${prefix}postal_code`)
  return {
    countryCode: text(value, `${prefix}country_code`),
    city: text(value, `${prefix}city`),
    street: text(value, `${prefix}street`),
    county,
    ...(sector === undefined ? {} : { sector }),
    ...(postalCode === undefined ? {} : { postalCode }),
  }
}

// Column names keep the pre-rename vocabulary on purpose (phase 1 of the rename):
//   name -> legal_name, fiscalIdentifier -> tax_identifier, vatConfigurations -> issuer_tax_configurations,
//   vatRateCode -> tax_code, vatRate -> tax_rate, totalExcludingVat -> total_excluding_tax,
//   vatAmount -> tax_amount, totalIncludingVat -> total_including_tax, vatTotal -> tax_total,
//   vatBreakdown[].code -> tax_code, vatBreakdown[].vatBaseAmount -> taxable_amount.
export const partyFrom = (value: Row, prefix: string): PartySnapshot => ({
  name: text(value, `${prefix}legal_name`),
  fiscalIdentifier: text(value, `${prefix}tax_identifier`),
  address: addressFrom(value, prefix),
})

export const buyerFrom = (value: Row, prefix: string): BuyerSnapshot => ({
  ...partyFrom(value, prefix),
  partyType: text(value, `${prefix}party_type`) as BuyerSnapshot["partyType"],
  vatRegistered: booleanInteger(value, `${prefix}vat_registered`),
})

export const addressValues = (address: Address): ReadonlyArray<QueryValue> => [
  address.countryCode,
  address.city,
  address.street,
  address.county,
  address.sector ?? null,
  address.postalCode ?? null,
]

/** The address columns, in the order `addressValues` binds them. */
export const addressColumns = (prefix = ""): ReadonlyArray<string> => [
  `${prefix}country_code`, `${prefix}city`, `${prefix}street`,
  `${prefix}county`, `${prefix}sector`, `${prefix}postal_code`,
]
