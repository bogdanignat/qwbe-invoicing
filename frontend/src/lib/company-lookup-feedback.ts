import { ApiFailure, isTransientFailure } from "./api-errors.ts"
import type { ResourceSnapshot } from "./async-resource.ts"
import { OPENAPI_NEEDS_KEY, type CompanyLookupSettings } from "./company-lookup-settings.ts"

/**
 * What Integrări says when the backend refuses, in Romanian.
 *
 * The settings routes answer `settings.manage` with a `403`, whose shared
 * wording names a document; a `400` carries the domain's English issues
 * (`cubes/invoicing/company-lookup/domain/settings.ts`). Both are read here, for
 * this screen. The `409` of a missing master key has a code, so its sentence
 * lives with the other codes in `api-errors.ts` and arrives already localized.
 * The browser never checks the permission itself: the `403` is the answer.
 */
export const INTEGRATIONS_DENIED = "Nu ai permisiunea de a administra integrările. Cere-i administratorului aplicației acest drept."

const ISSUE_MESSAGES: ReadonlyArray<readonly [prefix: string, message: string]> = [
  ["openapiKey must be", "Cheia openapi.ro nu este validă: trebuie să aibă 10–200 de caractere, fără spații."],
  ["provider openapi requires", OPENAPI_NEEDS_KEY],
]
const INVALID_SETTINGS = "Setările trimise nu sunt valide. Reîncarcă pagina și încearcă din nou."

export const companyLookupFailureMessage = (error: unknown): string => {
  if (!(error instanceof Error)) return "A apărut o eroare neașteptată."
  if (!(error instanceof ApiFailure)) return error.message
  if (error.status === 403) return INTEGRATIONS_DENIED
  if (error.status !== 400) return error.message
  for (const issue of error.issues) {
    const known = ISSUE_MESSAGES.find(([prefix]) => issue.startsWith(prefix))
    if (known !== undefined) return known[1]
  }
  return INVALID_SETTINGS
}

/** What the screen shows before it can show switches. `off`: the plugin is not running, nothing is asked. */
export type IntegrationsLoad =
  | { readonly kind: "off" }
  | { readonly kind: "loading" }
  | { readonly kind: "denied"; readonly message: string }
  | { readonly kind: "error"; readonly message: string; readonly transient: boolean }
  | { readonly kind: "ready"; readonly settings: CompanyLookupSettings }

export const integrationsLoad = (enabled: boolean, read: ResourceSnapshot<CompanyLookupSettings>): IntegrationsLoad => {
  if (!enabled) return { kind: "off" }
  // Data wins over a later failed refetch: the switches stay while a refresh fails.
  if (read.data !== undefined) return { kind: "ready", settings: read.data }
  if (read.error === null || read.error === undefined) return { kind: "loading" }
  if (read.error instanceof ApiFailure && read.error.status === 403) return { kind: "denied", message: INTEGRATIONS_DENIED }
  return { kind: "error", message: companyLookupFailureMessage(read.error), transient: isTransientFailure(read.error) }
}
