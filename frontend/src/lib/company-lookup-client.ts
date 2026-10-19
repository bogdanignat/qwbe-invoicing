import type { BrowserTransport } from "./browser-transport.ts"
import {
  decodeAvailability, decodeProposal, decodeSuggestions,
  type CompanyLookupAvailability, type CompanyProposal, type CompanySuggestion,
} from "./company-lookup-model.ts"
import {
  decodeCompanyLookupSettings, type CompanyLookupSettings, type CompanyLookupSettingsInput,
} from "./company-lookup-settings.ts"

/**
 * The company-lookup plugin's routes (`kernel/api/http-endpoints-company-lookup.ts`).
 * They exist only while the plugin runs, so only a caller that checked the
 * session's plugins may use this client. The write carries CSRF and no
 * idempotency key: a `PUT` of the same body is the same state. The lookup and
 * the search are reads sent as `POST`, so they carry CSRF too.
 */
export interface CompanyLookupClient {
  readonly getSettings: (signal: AbortSignal) => Promise<CompanyLookupSettings>
  readonly saveSettings: (csrfToken: string, body: CompanyLookupSettingsInput) => Promise<CompanyLookupSettings>
  readonly availability: (signal: AbortSignal) => Promise<CompanyLookupAvailability>
  readonly lookup: (csrfToken: string, cui: string, signal: AbortSignal) => Promise<CompanyProposal>
  readonly search: (csrfToken: string, q: string, signal: AbortSignal) => Promise<ReadonlyArray<CompanySuggestion>>
}

/** The plugin's query keys: a saved setting refreshes what the forms read from `availability`. */
export const companyLookupQueryKeys = {
  settings: ["company-lookup", "settings"],
  availability: ["company-lookup", "availability"],
  lookup: ["company-lookup", "lookup"],
  search: ["company-lookup", "search"],
} as const

export const createCompanyLookupClient = (transport: BrowserTransport): CompanyLookupClient => ({
  getSettings: async (signal) =>
    decodeCompanyLookupSettings(await transport.json("/api/settings/company-lookup", { signal })),
  saveSettings: async (csrfToken, body) =>
    decodeCompanyLookupSettings(await transport.json("/api/settings/company-lookup", { csrfToken, method: "PUT", body })),
  availability: async (signal) =>
    decodeAvailability(await transport.json("/api/company-lookup/availability", { signal })),
  lookup: async (csrfToken, cui, signal) =>
    decodeProposal(await transport.json("/api/company-lookup/lookup", { csrfToken, method: "POST", body: { cui }, signal })),
  search: async (csrfToken, q, signal) =>
    decodeSuggestions(await transport.json("/api/company-lookup/search", { csrfToken, method: "POST", body: { q }, signal })),
})
