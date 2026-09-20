import { Schema } from "effect"

import type { BuyerSource } from "../../cube/invoicing/index.ts"

export const optional = <S extends Schema.Schema.All>(schema: S) => Schema.optionalWith(schema, { exact: true })
export const optionalString = optional(Schema.String)
export const nullableString = Schema.NullOr(Schema.String)
export const optionalNullableString = optional(nullableString)
export const allErrors = { parseOptions: { errors: "all" as const } }
export const bodyObject = { ...allErrors, message: () => "request body must be a JSON object" }
export const FiscalIdentifierInput = Schema.transform(Schema.String, Schema.String, {
  strict: true, decode: (value) => value.trim().toUpperCase(), encode: (value) => value,
})

export const DocumentNotes = Schema.NullOr(Schema.String).pipe(
  Schema.filter((value): ReadonlyArray<Schema.FilterIssue> => {
    if (value === null) return []
    const issues: Array<Schema.FilterIssue> = []
    if (value.trim().length === 0) issues.push({ path: [], message: "notes is required" })
    if (value !== value.trim()) issues.push({ path: [], message: "notes must not have surrounding whitespace" })
    if (value.length > 300) issues.push({ path: [], message: "notes must be at most 300 characters" })
    if (/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/u.test(value)) issues.push({ path: [], message: "notes must not contain control characters" })
    return issues
  }, {
    description: "1-300 characters, no surrounding whitespace or control characters except LF newlines.",
    jsonSchema: { anyOf: [{ type: "string", minLength: 1, maxLength: 300 }, { type: "null" }] },
  }),
)
export const optionalNullableNotes = optional(DocumentNotes)

export const Address = Schema.Struct({
  countryCode: Schema.String, city: Schema.String, street: Schema.String, county: Schema.String,
  sector: optional(Schema.Int), postalCode: optionalString,
}).annotations(bodyObject)
export const Party = Schema.Struct({ name: Schema.String, fiscalIdentifier: Schema.String, address: Address })
export const Buyer = Schema.Struct({
  partyType: Schema.Literal("company", "individual"), vatRegistered: Schema.Boolean,
  name: Schema.String, fiscalIdentifier: Schema.String, address: Address,
})
export const BuyerInput = Schema.Struct({ ...Buyer.fields, fiscalIdentifier: FiscalIdentifierInput }).annotations(bodyObject)

export const UnitOfMeasure = Schema.Struct({ code: Schema.String, name: Schema.String }).annotations(bodyObject)
export const DocumentSource = Schema.Struct({ app: Schema.String, kind: Schema.String, id: Schema.String }).annotations(bodyObject)
export const SourceQueryFields = Schema.Struct({ sourceApp: optionalString, sourceKind: optionalString, sourceId: optionalString })
export const requireCompleteSource = <A extends Schema.Schema.Type<typeof SourceQueryFields>, I, R>(schema: Schema.Schema<A, I, R>) =>
  schema.pipe(Schema.filter((input): input is A & (
    { readonly sourceApp: string, readonly sourceKind: string, readonly sourceId: string } |
    { readonly sourceApp?: never, readonly sourceKind?: never, readonly sourceId?: never }
  ) => {
    const values = [input.sourceApp, input.sourceKind, input.sourceId]
    return values.every((value) => value === undefined) || values.every((value) => value !== undefined)
  }, { message: () => "sourceApp, sourceKind, and sourceId must be supplied exactly once and together" }))
export const SourceFilter = SourceQueryFields.pipe(requireCompleteSource)
const PageLimit = Schema.String.pipe(
  Schema.pattern(/^\d{1,6}$/, { message: () => "limit must be an integer" }),
  Schema.transform(Schema.Number, { strict: true, decode: Number, encode: String }),
).annotations({ description: "Page size, 1-200, default 100." })
export const PageQuery = Schema.Struct({
  limit: optional(PageLimit), cursor: optional(Schema.String.annotations({ description: "Opaque nextCursor of the previous page." })),
}).annotations(allErrors)
export const ListQuery = Schema.Struct({ ...SourceQueryFields.fields, ...PageQuery.fields }).annotations(allErrors).pipe(requireCompleteSource)
export const pageOf = <A, I, R>(item: Schema.Schema<A, I, R>) =>
  Schema.Struct({ items: Schema.Array(item), nextCursor: Schema.NullOr(Schema.String) })

export const BuyerSelection = Schema.Struct({ customerId: optionalString, customer: optional(BuyerInput) })
export const requireBuyer = <A extends Schema.Schema.Type<typeof BuyerSelection>, I, R>(schema: Schema.Schema<A, I, R>) =>
  schema.annotations({ description: "Exactly one of customerId or customer is required." }).pipe(
    Schema.filter((input): input is A & BuyerSource => (input.customerId !== undefined) !== (input.customer !== undefined), {
      message: () => "exactly one of customerId or customer is required",
    }),
  )
