import { Redacted } from "effect"

import { ValidationFailure } from "../../contracts/failures.ts"

export const LOOKUP_PROVIDERS = ["none", "anaf", "openapi"] as const
export type LookupProvider = typeof LOOKUP_PROVIDERS[number]

/** What the plugin keeps per organization. The key stays redacted everywhere it travels. */
export interface CompanyLookupSettings {
  readonly provider: LookupProvider
  readonly openapiKey?: Redacted.Redacted
}

export interface SettingsUpdate {
  readonly provider: string
  readonly openapiKey?: Redacted.Redacted
  readonly clearOpenapiKey?: boolean
}

export type KeyChange =
  | { readonly kind: "keep" }
  | { readonly kind: "set"; readonly key: Redacted.Redacted }
  | { readonly kind: "clear" }

export interface ValidatedSettingsUpdate {
  readonly provider: LookupProvider
  readonly openapiKey: KeyChange
}

/** What the browser may see of the settings: never the key, only whether one exists and its last four characters. */
export interface SettingsView {
  readonly provider: LookupProvider
  readonly openapiKeyConfigured: boolean
  readonly openapiKeyLast4: string | null
}

export const defaultSettings: CompanyLookupSettings = { provider: "none" }

// Visible ASCII, no spaces: a pasted key with a stray space or newline is refused, not stored.
const OPENAPI_KEY = /^[\x21-\x7e]{10,200}$/u

const isProvider = (value: string): value is LookupProvider => (LOOKUP_PROVIDERS as ReadonlyArray<string>).includes(value)

export const validateSettingsUpdate = (update: SettingsUpdate, current: CompanyLookupSettings): ValidatedSettingsUpdate => {
  const issues: Array<string> = []
  if (!isProvider(update.provider)) issues.push(`provider must be one of ${LOOKUP_PROVIDERS.join(", ")}`)
  const key = update.openapiKey
  if (key !== undefined && update.clearOpenapiKey === true) issues.push("openapiKey and clearOpenapiKey cannot be combined")
  if (key !== undefined && !OPENAPI_KEY.test(Redacted.value(key))) {
    issues.push("openapiKey must be 10 to 200 printable ASCII characters without spaces")
  }
  const openapiKey: KeyChange = key !== undefined ? { kind: "set", key }
    : update.clearOpenapiKey === true ? { kind: "clear" } : { kind: "keep" }
  const keyAfter = openapiKey.kind === "set" || (openapiKey.kind === "keep" && current.openapiKey !== undefined)
  if (update.provider === "openapi" && !keyAfter) issues.push("provider openapi requires a configured openapiKey")
  if (issues.length > 0) throw new ValidationFailure({ issues })
  return { provider: update.provider as LookupProvider, openapiKey }
}

export const applySettingsUpdate = (current: CompanyLookupSettings, update: ValidatedSettingsUpdate): CompanyLookupSettings => {
  const key = update.openapiKey.kind === "set" ? update.openapiKey.key
    : update.openapiKey.kind === "keep" ? current.openapiKey : undefined
  return key === undefined ? { provider: update.provider } : { provider: update.provider, openapiKey: key }
}

export const settingsView = (settings: CompanyLookupSettings): SettingsView => ({
  provider: settings.provider,
  openapiKeyConfigured: settings.openapiKey !== undefined,
  openapiKeyLast4: settings.openapiKey === undefined ? null : Redacted.value(settings.openapiKey).slice(-4),
})
