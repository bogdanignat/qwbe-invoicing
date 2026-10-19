import { ApiFailure } from "./api-errors.ts"
import type { ResourceSnapshot } from "./async-resource.ts"
import type { CompanyLookupAvailability, CompanyProposal } from "./company-lookup-model.ts"
import { isValidRomanianCui } from "./romanian-cui.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"

/**
 * When a form may ask the company-lookup routes, and what it says about the answer.
 *
 * Nothing leaves below the thresholds Bogdan fixed (a CUI of at least 4 digits
 * with a valid check digit, a name of at least 6 letters); the server's own,
 * read from `availability`, can only raise them. A query is asked once it has
 * stood still for `LOOKUP_DEBOUNCE_MS`, never per key.
 */
export const LOOKUP_DEBOUNCE_MS = 600
export const MIN_CUI_DIGITS = 4
export const MIN_NAME_LETTERS = 6
export const MAX_NAME_LENGTH = 100

export const QUOTA_EXCEEDED = "Cererile openapi.ro s-au terminat."
const UNREACHABLE = "Datele firmei nu pot fi verificate acum. Poți completa formularul manual."
const UNREADABLE = "Răspunsul furnizorului nu poate fi citit. Poți completa formularul manual."

/** Usable only with a provider on: `none`, a refused read (`403`) or any failure is no feature at all. */
export const usableAvailability = (read: ResourceSnapshot<CompanyLookupAvailability>): CompanyLookupAvailability | undefined =>
  read.data === undefined || read.data.provider === "none" ? undefined : read.data

export const cuiLookupQuery = (availability: CompanyLookupAvailability | undefined, raw: string): string | undefined => {
  if (availability === undefined) return undefined
  const cui = normalizeRomanianCui(raw)
  if (!/^\d+$/u.test(cui) || cui.length < Math.max(MIN_CUI_DIGITS, availability.minCuiDigits)) return undefined
  return isValidRomanianCui(cui) ? cui : undefined
}

export const nameSearchQuery = (availability: CompanyLookupAvailability | undefined, raw: string): string | undefined => {
  if (availability?.nameSearch !== true) return undefined
  const name = raw.trim()
  if (name.length > MAX_NAME_LENGTH) return undefined
  const letters = (name.match(/\p{L}/gu) ?? []).length
  return letters >= Math.max(MIN_NAME_LETTERS, availability.minNameLetters) ? name : undefined
}

/** A provider failure in one short sentence; the form stays usable by hand after any of them. */
export const lookupFailureMessage = (error: unknown): string => {
  if (!(error instanceof ApiFailure)) return UNREADABLE
  if (error.status === 429) return QUOTA_EXCEEDED
  if (error.status === undefined || error.status === 400 || error.status === 403) return UNREACHABLE
  // 409 (no provider, no name search) and the provider's 502/503 arrive already in Romanian.
  return error.message
}

export type LookupOutcome =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "found"; readonly proposal: CompanyProposal }
  | { readonly kind: "applied" }
  | { readonly kind: "not-found" }
  | { readonly kind: "failed"; readonly message: string }

/**
 * What the card shows for the CUI being looked up. A proposal already copied
 * into the form is not offered again until the CUI changes.
 */
export const lookupOutcome = (
  cui: string | undefined, read: ResourceSnapshot<CompanyProposal>, appliedCui: string | undefined,
): LookupOutcome => {
  if (cui === undefined) return { kind: "idle" }
  if (read.data !== undefined) return read.data.cui === appliedCui ? { kind: "applied" } : { kind: "found", proposal: read.data }
  if (read.error === null || read.error === undefined) return { kind: "pending" }
  if (read.error instanceof ApiFailure && read.error.status === 404) return { kind: "not-found" }
  return { kind: "failed", message: lookupFailureMessage(read.error) }
}

/** The line under the name field while suggestions are asked: in flight, none found, or why not. */
export const searchNote = (name: string | undefined, read: ResourceSnapshot<ReadonlyArray<unknown>>): string | undefined => {
  if (name === undefined) return undefined
  if (read.data !== undefined) return read.data.length === 0 ? "Nu am găsit nicio firmă cu acest nume." : undefined
  if (read.error === null || read.error === undefined) return "Se caută firme…"
  return lookupFailureMessage(read.error)
}
