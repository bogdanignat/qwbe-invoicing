import type { BrowserTransport } from "./browser-transport.ts"
import {
  decodeCompanyLookupSettings, type CompanyLookupSettings, type CompanyLookupSettingsInput,
} from "./company-lookup-settings.ts"

/**
 * The company-lookup plugin's settings routes (`kernel/api/http-endpoints-company-lookup.ts`).
 * They exist only while the plugin runs, so only a caller that checked the
 * session's plugins may use this client. The write carries CSRF and no
 * idempotency key: a `PUT` of the same body is the same state.
 */
export interface CompanyLookupClient {
  readonly getSettings: (signal: AbortSignal) => Promise<CompanyLookupSettings>
  readonly saveSettings: (csrfToken: string, body: CompanyLookupSettingsInput) => Promise<CompanyLookupSettings>
}

/** The plugin's query keys: a saved setting refreshes what the forms read from `availability`. */
export const companyLookupQueryKeys = {
  settings: ["company-lookup", "settings"],
  availability: ["company-lookup", "availability"],
} as const

export const createCompanyLookupClient = (transport: BrowserTransport): CompanyLookupClient => ({
  getSettings: async (signal) =>
    decodeCompanyLookupSettings(await transport.json("/api/settings/company-lookup", { signal })),
  saveSettings: async (csrfToken, body) =>
    decodeCompanyLookupSettings(await transport.json("/api/settings/company-lookup", { csrfToken, method: "PUT", body })),
})
