import { Effect, Schema } from "effect"

import type { AnafCompany, CompanyLookupProviders, ProviderFailure } from "../../cubes/invoicing/company-lookup/index.ts"
import { decoded, send, unavailable, type ProviderHttpOptions } from "./provider-http.ts"

export const ANAF_URL = "https://webservicesp.anaf.ro/api/PlatitorTvaRest/v9/tva"
/** ANAF limits how often a request starts (one a second), not how many are in flight. */
const INTERVAL_MS = 1_000
/** Callers waiting their turn; past this the answer is `unavailable` instead of an ever longer wait. */
const MAX_WAITING = 10

const Text = Schema.optional(Schema.NullOr(Schema.String))
const Company = Schema.Struct({
  date_generale: Schema.Struct({ cui: Schema.Number, denumire: Schema.String, nrRegCom: Text, stare_inregistrare: Text }),
  inregistrare_scop_Tva: Schema.Struct({ scpTVA: Schema.Boolean }),
  stare_inactiv: Schema.optional(Schema.Struct({ statusInactivi: Schema.optional(Schema.Boolean), dataRadiere: Text })),
  adresa_sediu_social: Schema.optional(Schema.Struct({
    sdenumire_Strada: Text, snumar_Strada: Text, sdenumire_Localitate: Text, scod_JudetAuto: Text, scod_Postal: Text,
  })),
})
const Answer = Schema.Struct({ found: Schema.Array(Company), notFound: Schema.Array(Schema.Unknown) })

const bucharestDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" })

export interface AnafOptions extends ProviderHttpOptions {
  readonly now?: () => Date
  readonly intervalMs?: number
}

/** One queue per client, so one per process: every organization shares ANAF's limit. */
export const createAnafClient = (options: AnafOptions): CompanyLookupProviders["anaf"] => {
  const now = options.now ?? (() => new Date())
  const interval = options.intervalMs ?? INTERVAL_MS
  const turn = Effect.unsafeMakeSemaphore(1)
  let lastStart = 0
  let waiting = 0

  const paced = <A>(call: Effect.Effect<A, ProviderFailure>) => Effect.suspend(() => {
    if (waiting >= MAX_WAITING) return Effect.fail(unavailable())
    waiting += 1
    let queued = true
    const leave = Effect.sync(() => { if (queued) { queued = false; waiting -= 1 } })
    // The permit is held only until this caller's start is booked; the request itself runs outside it.
    const slot = Effect.suspend(() => Effect.sleep(Math.max(0, lastStart + interval - Date.now()))).pipe(
      Effect.zipRight(Effect.sync(() => { lastStart = Date.now() })))
    return turn.withPermits(1)(Effect.zipRight(leave, slot)).pipe(Effect.ensuring(leave), Effect.zipRight(call))
  })

  return {
    lookup: ({ cui }) => paced(send(options, ANAF_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify([{ cui: Number(cui), data: bucharestDay.format(now()) }]),
    })).pipe(Effect.flatMap((reply): Effect.Effect<AnafCompany | undefined, ProviderFailure> => {
      if (reply.status !== 200) return Effect.fail(unavailable())
      return Effect.flatMap(decoded(Answer, reply.text), ({ found, notFound }) => {
        const company = found[0]
        if (company === undefined) return notFound.length > 0 ? Effect.succeed(undefined) : Effect.fail(unavailable())
        // An answer about another CUI is not an answer to this question.
        return company.date_generale.cui === Number(cui) ? Effect.succeed(company) : Effect.fail(unavailable())
      })
    })),
  }
}
