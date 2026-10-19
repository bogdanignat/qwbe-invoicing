import { Effect, Redacted, Schema } from "effect"

import { ProviderFailure, type CompanyLookupProviders } from "../../cubes/invoicing/company-lookup/index.ts"
import { decoded, retryAfter, send, unavailable, type ProviderHttpOptions, type ProviderReply } from "./provider-http.ts"

export const OPENAPI_COMPANY_URL = "https://api.openapi.ro/api/companies/"
export const OPENAPI_SEARCH_URL = "https://api.openapi.ro/api/companies/search"
/** openapi.ro queues a cold lookup with 202; without its own hint the caller is told to retry in this many seconds. */
const PENDING_RETRY_SECONDS = 5

const Text = Schema.optional(Schema.NullOr(Schema.String))
// The CIF is text in the mapping; a provider that sends it as a number is not wrong about the company.
const Cif = Schema.Union(Schema.String, Schema.Number.pipe(Schema.int())).pipe(
  Schema.transform(Schema.String, { strict: true, decode: String, encode: (value) => value }))
const Company = Schema.Struct({
  cif: Cif, denumire: Schema.String, numar_reg_com: Text, adresa: Text, judet: Text, cod_postal: Text, tva: Text,
  radiata: Schema.optional(Schema.NullOr(Schema.Boolean)),
})
const Suggestions = Schema.Struct({ data: Schema.Array(Schema.Struct({ cif: Cif, denumire: Schema.String, judet: Text })) })
const Pending = Schema.Struct({ retry_after: Schema.optional(Schema.Unknown) })

/** The answers that are not data, in one place for both operations. */
const failureOf = (reply: ProviderReply): ProviderFailure => {
  switch (reply.status) {
    case 202: {
      const hint = Schema.decodeUnknownOption(Schema.parseJson(Pending))(reply.text)
      const seconds = hint._tag === "Some" ? retryAfter(hint.value.retry_after) : undefined
      return new ProviderFailure({ reason: "pending",
        retryAfterSeconds: seconds ?? retryAfter(reply.headers.get("retry-after")) ?? PENDING_RETRY_SECONDS })
    }
    case 429: {
      const seconds = retryAfter(reply.headers.get("retry-after"))
      return new ProviderFailure(seconds === undefined ? { reason: "quota_exceeded" } : { reason: "quota_exceeded", retryAfterSeconds: seconds })
    }
    case 401:
    case 403: return new ProviderFailure({ reason: "auth_failed" })
    default: return unavailable()
  }
}

const keyed = (apiKey: Redacted.Redacted, json: boolean): Record<string, string> =>
  ({ accept: "application/json", "x-api-key": Redacted.value(apiKey), ...(json ? { "content-type": "application/json" } : {}) })

export const createOpenapiClient = (options: ProviderHttpOptions): CompanyLookupProviders["openapi"] => ({
  lookup: ({ cui, apiKey }) => send(options, `${OPENAPI_COMPANY_URL}${encodeURIComponent(cui)}`, { method: "GET", headers: keyed(apiKey, false) })
    .pipe(Effect.flatMap((reply) => reply.status === 200 ? Effect.map(decoded(Company, reply.text), (company) => ({ ...company, radiata: company.radiata === true }))
      : reply.status === 404 ? Effect.succeed(undefined) : Effect.fail(failureOf(reply)))),
  search: ({ query, apiKey }) => send(options, OPENAPI_SEARCH_URL, { method: "POST", headers: keyed(apiKey, true), body: JSON.stringify({ q: query }) })
    .pipe(Effect.flatMap((reply) => reply.status === 200 ? Effect.map(decoded(Suggestions, reply.text), ({ data }) => data)
      : reply.status === 404 ? Effect.succeed([]) : Effect.fail(failureOf(reply)))),
})
