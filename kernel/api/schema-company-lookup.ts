import { HttpApiSchema } from "@effect/platform"
import { Schema } from "effect"

import type { ProviderFailureReason } from "../../cubes/invoicing/company-lookup/index.ts"
import { bodyObject, optional, optionalString } from "./schema-primitives.ts"

const Provider = Schema.Literal("none", "anaf", "openapi")
// The default decode message quotes the value it refused, and the key travels in this body.
const quiet = (message: string) => ({ message: () => message })

/** `openapiKey` is write-only: decoded straight into a redacted value, never answered. */
export const CompanyLookupSettingsInput = Schema.Struct({
  provider: Schema.String.annotations(quiet("provider must be a string")),
  openapiKey: optional(Schema.Redacted(Schema.String.annotations(quiet("openapiKey must be a string")))),
  clearOpenapiKey: optional(Schema.Boolean.annotations(quiet("clearOpenapiKey must be a boolean"))),
}).annotations(bodyObject)
export const CompanyLookupSettings = Schema.Struct({
  provider: Provider, openapiKeyConfigured: Schema.Boolean, openapiKeyLast4: Schema.NullOr(Schema.String),
})
export const CompanyLookupAvailability = Schema.Struct({
  provider: Provider, nameSearch: Schema.Boolean, minCuiDigits: Schema.Int, minNameLetters: Schema.Int,
})
export const CompanyLookupInput = Schema.Struct({ cui: Schema.String }).annotations(bodyObject)
export const CompanySearchInput = Schema.Struct({ q: Schema.String }).annotations(bodyObject)

const ProposedAddress = Schema.Struct({
  county: optionalString, sector: optional(Schema.Int), city: optionalString, street: optionalString,
  postalCode: optionalString, original: optionalString,
})
export const CompanyProposal = Schema.Struct({
  name: Schema.String, cui: Schema.String, vatRegistered: Schema.Boolean, tradeRegisterNumber: optionalString,
  inactive: optional(Schema.Boolean), deregistered: Schema.Boolean, address: ProposedAddress,
})
export const CompanySuggestions = Schema.Struct({
  items: Schema.Array(Schema.Struct({ cui: Schema.String, name: Schema.String, county: optionalString })),
})

const providerError = <const Reason extends ProviderFailureReason>(status: number, reason: Reason, description: string) =>
  Schema.Struct({
    error: Schema.Literal("ProviderFailure"), reason: Schema.Literal(reason), message: Schema.String,
    retryAfterSeconds: optional(Schema.Int),
  }).annotations(HttpApiSchema.annotations({ status, description }))

/** Never 401: the browser ends the session on a 401, and a refused provider key is not a refused session. */
export const providerErrors = [
  providerError(429, "quota_exceeded", "The openapi.ro request quota is used up."),
  providerError(503, "pending", "openapi.ro is preparing the answer; retry after retryAfterSeconds."),
  providerError(502, "auth_failed", "openapi.ro refused the configured key."),
  providerError(502, "unavailable", "The provider did not answer usably."),
] as const
