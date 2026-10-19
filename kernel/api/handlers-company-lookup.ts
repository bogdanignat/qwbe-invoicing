import { HttpApiBuilder } from "@effect/platform"
import { Effect } from "effect"

import { invoicingPermissions } from "../../cubes/invoicing/index.ts"
import {
  companyLookupPermission, createCompanyLookupService, cube, type CompanyLookupService,
} from "../../cubes/invoicing/company-lookup/index.ts"
import { createCompanyLookupProviders } from "../company-lookup/providers.ts"
import { createPostgresCompanyLookupStore } from "../storage/postgres-company-lookup.ts"
import { CurrentRequest } from "./api-context.ts"
import { errors } from "./api-failures.ts"
import type { ApiRuntime } from "./api-types.ts"
import { companyLookupHttpApi } from "./http-api.ts"

/**
 * The company-lookup plugin's routes, mounted by `createApiHandler` only with the
 * plugin on. The providers, their cache and ANAF's queue are built here, once
 * per handler; only the service around them is per request, for its context.
 */
export const companyLookupGroup = (runtime: ApiRuntime) => {
  const providers = createCompanyLookupProviders({ transport: runtime.transport ?? fetch, ...(runtime.now ? { now: runtime.now } : {}) })
  const settings = createPostgresCompanyLookupStore(runtime.pool, runtime.companyLookupKey)
  const permissions = { lookup: companyLookupPermission(cube.manifest.name), manageSettings: invoicingPermissions("invoicing").manageSettings }
  const clock = { now: Effect.sync(runtime.now ?? (() => new Date())) }
  const use = <A, E>(operation: (service: CompanyLookupService) => Effect.Effect<A, E>) => Effect.flatMap(CurrentRequest, (context) =>
    operation(createCompanyLookupService({ context: { current: Effect.succeed(context) }, clock, settings, providers, permissions })))
  return HttpApiBuilder.group(companyLookupHttpApi, "invoicing", (handlers) => handlers
    .handle("getCompanyLookupSettings", () => use((s) => s.getSettings).pipe(Effect.mapError(errors())))
    .handle("updateCompanyLookupSettings", ({ payload }) => use((s) => s.updateSettings(payload)).pipe(
      Effect.mapError(errors("ValidationFailure", "DomainConflict"))))
    .handle("getCompanyLookupAvailability", () => use((s) => s.availability).pipe(Effect.mapError(errors())))
    .handle("lookupCompany", ({ payload }) => use((s) => s.lookup(payload.cui)).pipe(
      Effect.mapError(errors("ValidationFailure", "ResourceNotFound", "DomainConflict", "ProviderFailure"))))
    .handle("searchCompanies", ({ payload }) => use((s) => Effect.map(s.search(payload.q), (items) => ({ items }))).pipe(
      Effect.mapError(errors("ValidationFailure", "DomainConflict", "ProviderFailure")))))
}
