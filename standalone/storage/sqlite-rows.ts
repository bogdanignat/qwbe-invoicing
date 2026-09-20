import { Effect } from "effect"

import {
  DomainConflict,
  PersistenceFailure,
  type Address,
  type BuyerSnapshot,
  type NameCursor,
  type PageQuery,
  type PartySnapshot,
} from "../../cube/invoicing/index.ts"

// Row decoding and failure mapping shared by the SQLite adapters of invoicing and its
// child cubes; every adapter runs on the connection of the one open transaction.
export type WriteFailure = DomainConflict | PersistenceFailure
export type Row = Readonly<Record<string, unknown>>

export const persistence = (operation: string) => new PersistenceFailure({ operation })

export const writeFailure = (error: unknown, operation: string): WriteFailure => {
  if (error instanceof DomainConflict) return error
  if (typeof error === "object" && error !== null
    && (("code" in error && typeof error.code === "string" && error.code.includes("SQLITE_CONSTRAINT"))
      || ("errcode" in error && typeof error.errcode === "number" && (error.errcode & 0xff) === 19))) {
    return operation === "save proforma conversion" || operation === "save proforma invoice conversion"
      ? new DomainConflict({ code: "proforma_already_converted", message: "Proforma was already converted" })
      : new DomainConflict({ code: "persistence_conflict", message: `Conflict while performing ${operation}` })
  }
  return persistence(operation)
}

export const write = <Value>(operation: string, run: () => Value): Effect.Effect<Value, WriteFailure> =>
  Effect.try({ try: run, catch: (error) => writeFailure(error, operation) })

export const read = <Value>(operation: string, run: () => Value): Effect.Effect<Value, PersistenceFailure> =>
  Effect.try({ try: run, catch: () => persistence(operation) })

export const row = (value: unknown): Row | undefined =>
  typeof value === "object" && value !== null ? value as Row : undefined

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

export const nameKeyset = (page: PageQuery<NameCursor>, column: string) => page.after === undefined
  ? { sql: "", values: [] as ReadonlyArray<string> }
  : { sql: ` AND (${column} COLLATE NOCASE > ? OR (${column} COLLATE NOCASE = ? AND id > ?))`, values: [page.after.name, page.after.name, page.after.id] }
export const rowsWanted = (page: PageQuery<unknown>): number => page.limit + 1

export const addressValues = (address: Address): ReadonlyArray<string | number | null> => [
  address.countryCode,
  address.city,
  address.street,
  address.county,
  address.sector ?? null,
  address.postalCode ?? null,
]
