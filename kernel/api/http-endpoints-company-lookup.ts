import { HttpApiEndpoint } from "@effect/platform"
import type { HttpMethod } from "@effect/platform/HttpMethod"

import { body, conflict, invoicingBase, notFound, validation } from "./http-api-shared.ts"
import * as L from "./schema-company-lookup.ts"

type Endpoint<N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE> =
  HttpApiEndpoint.HttpApiEndpoint<N, M, P, U, B, H, S, E1, R, RE>
const [quota, pending, authFailed, unavailable] = L.providerErrors
const provider = <N extends string, M extends HttpMethod, P, U, B, H, S, E1, R, RE>(endpoint: Endpoint<N, M, P, U, B, H, S, E1, R, RE>) =>
  endpoint.addError(quota).addError(pending).addError(authFailed).addError(unavailable)

/** The company-lookup plugin's routes. Lookups are POST so the browser's CSRF check covers them. */
export const companyLookupEndpoints = {
  getCompanyLookupSettings: invoicingBase(HttpApiEndpoint.get("getCompanyLookupSettings", "/settings/company-lookup")
    .addSuccess(L.CompanyLookupSettings)),
  updateCompanyLookupSettings: invoicingBase(conflict(validation(body(HttpApiEndpoint.put("updateCompanyLookupSettings", "/settings/company-lookup")
    .setPayload(L.CompanyLookupSettingsInput).addSuccess(L.CompanyLookupSettings))))),
  getCompanyLookupAvailability: invoicingBase(HttpApiEndpoint.get("getCompanyLookupAvailability", "/company-lookup/availability")
    .addSuccess(L.CompanyLookupAvailability)),
  lookupCompany: invoicingBase(provider(conflict(notFound(validation(body(HttpApiEndpoint.post("lookupCompany", "/company-lookup/lookup")
    .setPayload(L.CompanyLookupInput).addSuccess(L.CompanyProposal))))))),
  searchCompanies: invoicingBase(provider(conflict(validation(body(HttpApiEndpoint.post("searchCompanies", "/company-lookup/search")
    .setPayload(L.CompanySearchInput).addSuccess(L.CompanySuggestions)))))),
} as const
