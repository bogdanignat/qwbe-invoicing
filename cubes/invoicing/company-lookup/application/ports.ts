import type { Effect, Redacted } from "effect"

import type { DomainConflict, PersistenceFailure } from "../../contracts/failures.ts"
import type { ProviderFailure } from "../contracts/failures.ts"
import type { AnafCompany, OpenapiCompany, OpenapiSuggestion } from "../contracts/providers.ts"
import type { CompanyLookupSettings, KeyChange, LookupProvider } from "../domain/settings.ts"

/** The organization's row. `version` changes with every write, so the host can key what it caches by it. */
export interface StoredSettings extends CompanyLookupSettings {
  readonly version: string
}

export interface SettingsWrite {
  readonly organizationId: string
  readonly provider: LookupProvider
  readonly openapiKey: KeyChange
  readonly updatedAt: string
  readonly updatedBy: string
}

/** The host encrypts the key on write and decrypts it on read; the cube sees it only redacted. */
export interface CompanyLookupSettingsStore {
  readonly read: (organizationId: string) => Effect.Effect<StoredSettings | undefined, PersistenceFailure>
  readonly write: (settings: SettingsWrite) => Effect.Effect<void, DomainConflict | PersistenceFailure>
}

/** Who asks, under which settings: enough for the host to key a cache the cube does not know about. */
export interface ProviderRequest {
  readonly organizationId: string
  readonly settingsVersion: string
}

type Answer<Value> = Effect.Effect<Value, ProviderFailure>
type Keyed = ProviderRequest & { readonly apiKey: Redacted.Redacted }

/** `undefined` means the provider does not know the CUI. */
export interface CompanyLookupProviders {
  readonly anaf: {
    readonly lookup: (request: ProviderRequest & { readonly cui: string }) => Answer<AnafCompany | undefined>
  }
  readonly openapi: {
    readonly lookup: (request: Keyed & { readonly cui: string }) => Answer<OpenapiCompany | undefined>
    readonly search: (request: Keyed & { readonly query: string }) => Answer<ReadonlyArray<OpenapiSuggestion>>
  }
}
