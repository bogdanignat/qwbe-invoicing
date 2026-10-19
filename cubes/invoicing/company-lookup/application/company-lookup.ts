import { Effect } from "effect"

import { checked } from "../../application/support.ts"
import {
  DomainConflict, PermissionDenied, ResourceNotFound, type AuthenticationRequired, type OrganizationContextMissing,
  type PersistenceFailure, type ValidationFailure,
} from "../../contracts/failures.ts"
import type { Clock, RequestContext, RequestContextProvider } from "../../contracts/host.ts"
import type { ProviderFailure } from "../contracts/failures.ts"
import type { CompanyLookupPermissions } from "../contracts/permissions.ts"
import { proposalFromAnaf, proposalFromOpenapi, suggestionsFromOpenapi, type CompanyProposal, type CompanySuggestion } from "../domain/proposal.ts"
import { MIN_CUI_DIGITS, MIN_NAME_LETTERS, cuiQuery, nameQuery } from "../domain/query.ts"
import {
  applySettingsUpdate, defaultSettings, settingsView, validateSettingsUpdate, type LookupProvider, type SettingsUpdate, type SettingsView,
} from "../domain/settings.ts"
import type { CompanyLookupProviders, CompanyLookupSettingsStore, StoredSettings } from "./ports.ts"

export interface CompanyLookupDependencies {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly settings: CompanyLookupSettingsStore
  readonly providers: CompanyLookupProviders
  readonly permissions: CompanyLookupPermissions
}

export type CompanyLookupFailure = AuthenticationRequired | OrganizationContextMissing | PermissionDenied
  | ValidationFailure | ResourceNotFound | DomainConflict | PersistenceFailure | ProviderFailure

/** What the forms need to know before they ask anything. */
export interface Availability {
  readonly provider: LookupProvider
  readonly nameSearch: boolean
  readonly minCuiDigits: number
  readonly minNameLetters: number
}

type Operation<Value> = Effect.Effect<Value, CompanyLookupFailure>

const notConfigured = new DomainConflict({ code: "company_lookup_not_configured", message: "no company lookup provider is configured" })
const searchUnavailable = new DomainConflict({ code: "company_search_unavailable", message: "the configured provider does not search by name" })

export interface CompanyLookupService {
  readonly getSettings: Operation<SettingsView>
  readonly updateSettings: (update: SettingsUpdate) => Operation<SettingsView>
  readonly availability: Operation<Availability>
  readonly lookup: (cui: string) => Operation<CompanyProposal>
  readonly search: (query: string) => Operation<ReadonlyArray<CompanySuggestion>>
}

export const createCompanyLookupService = (dependencies: CompanyLookupDependencies): CompanyLookupService => {
  const { permissions, providers, settings } = dependencies
  const authorize = (permission: string): Operation<RequestContext> => Effect.flatMap(dependencies.context.current, (context) =>
    context.identity.permissions.includes(permission) ? Effect.succeed(context) : Effect.fail(new PermissionDenied({ permission })))
  const stored = (context: RequestContext): Operation<StoredSettings | undefined> => settings.read(context.organization.id)
  const request = (context: RequestContext, current: StoredSettings) =>
    ({ organizationId: context.organization.id, settingsVersion: current.version })

  const proposalFor = (context: RequestContext, current: StoredSettings | undefined, cui: string): Operation<CompanyProposal | undefined> => {
    if (current?.provider === "anaf") {
      return Effect.map(providers.anaf.lookup({ ...request(context, current), cui }),
        (company) => company === undefined ? undefined : proposalFromAnaf(company))
    }
    if (current?.provider === "openapi" && current.openapiKey !== undefined) {
      return Effect.map(providers.openapi.lookup({ ...request(context, current), apiKey: current.openapiKey, cui }),
        (company) => company === undefined ? undefined : proposalFromOpenapi(company))
    }
    return Effect.fail(notConfigured)
  }

  return {
    getSettings: Effect.gen(function*() {
      const context = yield* authorize(permissions.manageSettings)
      return settingsView((yield* stored(context)) ?? defaultSettings)
    }),

    updateSettings: (update) => Effect.gen(function*() {
      const context = yield* authorize(permissions.manageSettings)
      const current = (yield* stored(context)) ?? defaultSettings
      const validated = yield* checked(() => validateSettingsUpdate(update, current))
      const now = yield* dependencies.clock.now
      yield* settings.write({ organizationId: context.organization.id, provider: validated.provider,
        openapiKey: validated.openapiKey, updatedAt: now.toISOString(), updatedBy: context.identity.id })
      return settingsView(applySettingsUpdate(current, validated))
    }),

    availability: Effect.gen(function*() {
      const context = yield* authorize(permissions.lookup)
      const provider = (yield* stored(context))?.provider ?? "none"
      return { provider, nameSearch: provider === "openapi", minCuiDigits: MIN_CUI_DIGITS, minNameLetters: MIN_NAME_LETTERS }
    }),

    // The query is checked before the settings are read, so a refused query never reaches a provider.
    lookup: (rawCui) => Effect.gen(function*() {
      const context = yield* authorize(permissions.lookup)
      const cui = yield* checked(() => cuiQuery(rawCui))
      const proposal = yield* proposalFor(context, yield* stored(context), cui)
      if (proposal === undefined) return yield* Effect.fail(new ResourceNotFound({ resource: "company", id: cui }))
      return proposal
    }),

    search: (rawQuery) => Effect.gen(function*() {
      const context = yield* authorize(permissions.lookup)
      const query = yield* checked(() => nameQuery(rawQuery))
      const current = yield* stored(context)
      if (current === undefined || current.provider === "none") return yield* Effect.fail(notConfigured)
      if (current.provider !== "openapi" || current.openapiKey === undefined) return yield* Effect.fail(searchUnavailable)
      return suggestionsFromOpenapi(yield* providers.openapi.search({ ...request(context, current), apiKey: current.openapiKey, query }))
    }),
  }
}
