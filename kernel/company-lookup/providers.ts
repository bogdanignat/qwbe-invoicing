import type { CompanyLookupProviders, ProviderRequest } from "../../cubes/invoicing/company-lookup/index.ts"
import { createAnafClient, type AnafOptions } from "./anaf-client.ts"
import { createLookupCache, type LookupCache } from "./lookup-cache.ts"
import { createOpenapiClient } from "./openapi-client.ts"

/**
 * The two providers behind one cache, built once per API handler (so once per
 * process), never per request. The cache key holds the settings version, so a
 * changed provider or key never answers from the old one; it never holds the key.
 */
export const createCompanyLookupProviders = (options: AnafOptions, cache: LookupCache = createLookupCache()): CompanyLookupProviders => {
  const anaf = createAnafClient(options)
  const openapi = createOpenapiClient(options)
  const key = (request: ProviderRequest, provider: string, operation: string, query: string): string =>
    JSON.stringify([request.organizationId, provider, request.settingsVersion, operation, query])
  return {
    anaf: { lookup: (request) => cache.get(key(request, "anaf", "lookup", request.cui), anaf.lookup(request)) },
    openapi: {
      lookup: (request) => cache.get(key(request, "openapi", "lookup", request.cui), openapi.lookup(request)),
      search: (request) => cache.get(key(request, "openapi", "search", request.query.toLocaleLowerCase("ro").replace(/\s+/gu, " ")),
        openapi.search(request)),
    },
  }
}
