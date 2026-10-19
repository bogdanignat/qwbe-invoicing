import { companyLookupPermission } from "./contracts/permissions.ts"

/**
 * The company-lookup plugin: proposes a company's details from its CUI or name,
 * through ANAF or openapi.ro. The cube is pure: it holds the settings rules, the
 * query thresholds and the mapping of each provider's answer to a proposal. HTTP,
 * key encryption and the settings row are the host's, behind the ports below.
 * Administering it takes the parent's `settings.manage`, which this cube does not declare.
 */
const identity = "company-lookup"
export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    summary: "Company details proposed from ANAF or openapi.ro by CUI or name",
    required: false,
    tables: ["company_lookup_settings"],
    requiresAuth: true,
    // The roles that edit customers, drafts or the issuer.
    permissions: [{ name: companyLookupPermission(identity), roles: ["admin"] }],
  },
  create: () => ({ handlers: {} }),
}

export * from "./contracts/index.ts"
export { MAX_NAME_LENGTH, MIN_CUI_DIGITS, MIN_NAME_LETTERS, cuiQuery, nameQuery, normalizeCui } from "./domain/query.ts"
export { LOOKUP_PROVIDERS } from "./domain/settings.ts"
export type { KeyChange, LookupProvider, SettingsUpdate, SettingsView } from "./domain/settings.ts"
export { proposalFromAnaf, proposalFromOpenapi, suggestionsFromOpenapi } from "./domain/proposal.ts"
export type { CompanyProposal, CompanySuggestion } from "./domain/proposal.ts"
export type { ProposedAddress } from "./domain/address.ts"
export { createCompanyLookupService } from "./application/company-lookup.ts"
export type { Availability, CompanyLookupDependencies, CompanyLookupFailure, CompanyLookupService } from "./application/company-lookup.ts"
export type { CompanyLookupProviders, CompanyLookupSettingsStore, ProviderRequest, SettingsWrite, StoredSettings } from "./application/ports.ts"
