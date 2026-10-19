import { boolean, nullableText, object } from "./model-decoder.ts"

/**
 * The company-lookup integration as Setări → Integrări edits it: which provider
 * fills companies in from a CUI, and whether an openapi.ro key is stored.
 *
 * The key is write-only. The answer says only that one exists and how it ends,
 * so nothing here ever holds a stored key; the draft typed in the field is the
 * only copy the browser sees, and it leaves with the one `PUT` that stores it.
 */
const PROVIDERS = ["none", "anaf", "openapi"] as const
export type LookupProvider = typeof PROVIDERS[number]
export type SwitchableProvider = Exclude<LookupProvider, "none">

export interface CompanyLookupSettings {
  readonly provider: LookupProvider
  readonly openapiKeyConfigured: boolean
  readonly openapiKeyLast4: string | null
}

export interface CompanyLookupSettingsInput {
  readonly provider: LookupProvider
  readonly openapiKey?: string
  readonly clearOpenapiKey?: true
}

/** What a write changed: only one that stores or drops the key closes the key field. */
export type SettingsTarget = "provider" | "key"

/** A screen action decided: one write to send, a refusal to show, or nothing to do. */
export type SettingsChange =
  | { readonly kind: "save"; readonly target: SettingsTarget; readonly input: CompanyLookupSettingsInput; readonly notice: string }
  | { readonly kind: "issue"; readonly message: string }
  | { readonly kind: "none" }

export const OPENAPI_NEEDS_KEY = "openapi.ro pornește doar cu o cheie salvată. Adaugă cheia mai jos, apoi pornește-l."

export const decodeCompanyLookupSettings = (input: unknown): CompanyLookupSettings => {
  const value = object(input)
  const provider = PROVIDERS.find((known) => known === value.provider)
  if (provider === undefined) throw new Error("invalid provider")
  const openapiKeyConfigured = boolean(value.openapiKeyConfigured, "openapiKeyConfigured")
  const openapiKeyLast4 = nullableText(value.openapiKeyLast4, "openapiKeyLast4")
  // Both say the same thing; an answer where they disagree is not one the screen can show.
  if (openapiKeyConfigured !== (openapiKeyLast4 !== null)) throw new Error("invalid openapiKeyLast4")
  return { provider, openapiKeyConfigured, openapiKeyLast4 }
}

const providerNotice = (provider: LookupProvider): string => {
  if (provider === "anaf") return "ANAF completează acum datele firmelor din CUI."
  if (provider === "openapi") return "openapi.ro completează acum datele firmelor din CUI și sugerează firme după nume."
  return "Completarea datelor firmelor este oprită."
}

/**
 * One switch moved. The two are exclusive: turning one on replaces whichever is
 * on, turning the one that is on off leaves none, and turning off one that is
 * already off asks nothing. openapi.ro without a stored key is refused here,
 * before the backend has to refuse it.
 */
export const providerToggle = (settings: CompanyLookupSettings, provider: SwitchableProvider, on: boolean): SettingsChange => {
  const next: LookupProvider = on ? provider : settings.provider === provider ? "none" : settings.provider
  if (next === settings.provider) return { kind: "none" }
  if (next === "openapi" && !settings.openapiKeyConfigured) return { kind: "issue", message: OPENAPI_NEEDS_KEY }
  return { kind: "save", target: "provider", input: { provider: next }, notice: providerNotice(next) }
}

/**
 * A key typed in. Surrounding whitespace is a paste artefact (a key never holds
 * a space), so it is dropped; whether the rest is a valid key is the backend's
 * answer. The provider is sent as it is, so saving a key never switches one.
 */
export const keySave = (settings: CompanyLookupSettings, draft: string): SettingsChange => {
  const openapiKey = draft.trim()
  if (openapiKey === "") return { kind: "issue", message: "Introdu cheia openapi.ro." }
  return { kind: "save", target: "key", input: { provider: settings.provider, openapiKey }, notice: "Cheia openapi.ro a fost salvată." }
}

/**
 * The stored key dropped. openapi.ro cannot stay on without it and the backend
 * refuses the pair, so the same write turns it off: one request, never a state
 * where the switch is on and the key gone.
 */
export const keyClear = (settings: CompanyLookupSettings): SettingsChange => {
  if (!settings.openapiKeyConfigured) return { kind: "none" }
  const stopsOpenapi = settings.provider === "openapi"
  return {
    kind: "save",
    target: "key",
    input: { provider: stopsOpenapi ? "none" : settings.provider, clearOpenapiKey: true },
    notice: stopsOpenapi ? "Cheia openapi.ro a fost ștearsă, iar openapi.ro a fost oprit." : "Cheia openapi.ro a fost ștearsă.",
  }
}

export const keyClearConfirm = (settings: CompanyLookupSettings): string => settings.provider === "openapi"
  ? "Ștergi cheia openapi.ro? openapi.ro se oprește odată cu ea, iar datele firmelor nu se mai completează până pornești alt furnizor."
  : "Ștergi cheia openapi.ro? Pentru a porni din nou openapi.ro va trebui să o introduci iar."

export const keyStatus = (settings: CompanyLookupSettings): string => settings.openapiKeyLast4 === null
  ? "Nicio cheie configurată."
  : `Cheie configurată, se termină în …${settings.openapiKeyLast4}`

/** The key field: the draft typed, and whether a stored key is being replaced. */
export interface KeyField {
  readonly draft: string
  readonly replacing: boolean
}

export const EMPTY_KEY_FIELD: KeyField = { draft: "", replacing: false }

/**
 * The key field once a write settled. A stored or dropped key empties it and
 * closes the replacement; a failure keeps the draft and the open field, so the
 * user corrects it instead of pasting it again; a provider switch leaves it alone.
 */
export const keyFieldAfterSave = (field: KeyField, outcome: SettingsTarget | "failed"): KeyField =>
  outcome === "key" ? EMPTY_KEY_FIELD : field
