import { useQuery } from "@tanstack/react-query"
import { useRef, useState, type RefObject } from "react"

import { useAuth } from "./auth-context.ts"
import { companyLookupAvailabilityQuery, companyLookupQuery, companySearchQuery } from "./company-lookup-queries.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { useSettledValue } from "./use-settled-value.ts"
import type { CompanyProposal, CompanySuggestion } from "../lib/company-lookup-model.ts"
import {
  LOOKUP_DEBOUNCE_MS, cuiLookupQuery, lookupOutcome, nameSearchQuery, searchNote, usableAvailability, type LookupOutcome,
} from "../lib/company-lookup-query.ts"
import { freshTyped, lookupTarget, reduceTyped, typedForScope, type TypedAction } from "../lib/company-lookup-typed.ts"
import { pluginActive } from "../lib/plugins.ts"

/**
 * Completing a company from its CUI or name, for one form. The same hook serves
 * the registry customer, the one-time buyer and the issuer.
 *
 * Only what the user types counts (`lib/company-lookup-typed.ts`): `typeCui`
 * and `typeName` are wired to the inputs, so opening a saved customer or filling
 * the form from a proposal never asks anything. A `scope` change (another
 * customer, another party type) drops what was typed in the same render, which
 * also cancels any pending wait. With the plugin off, no provider, or not a
 * company, every read is skipped.
 */
export interface CompanyLookupModel {
  /** openapi.ro is on: the name field offers suggestions. */
  readonly nameSearch: boolean
  readonly outcome: LookupOutcome
  /** Empty without name search, so the name field is the same input either way. */
  readonly suggestions: ReadonlyArray<CompanySuggestion>
  readonly searchNote: string | undefined
  readonly typeCui: (value: string) => void
  readonly typeName: (value: string) => void
  readonly pick: (suggestion: CompanySuggestion) => void
  readonly closeSuggestions: () => void
  /** The proposal was copied into the form: it is not offered again for the same CUI, and the focus goes to the name. */
  readonly applied: (proposal: CompanyProposal) => void
}

/** The model, and the name input's ref: the focus lands there once the card it was on is gone. Apart, so the model is never a ref. */
export interface CompanyLookup {
  readonly lookup: CompanyLookupModel
  readonly nameRef: RefObject<HTMLInputElement | null>
}

// One empty list for every render without suggestions, so the combobox keeps its state between them.
const NO_SUGGESTIONS: ReadonlyArray<CompanySuggestion> = []

export const useCompanyLookup = (scope: string, company: boolean): CompanyLookup => {
  const auth = useAuth()
  const { companyLookup: client } = useInvoicingClients()
  const enabled = company && pluginActive(auth, "company-lookup")
  const availabilityRead = useQuery(companyLookupAvailabilityQuery(client, enabled))
  const availability = enabled ? usableAvailability(availabilityRead) : undefined
  const provider = availability?.provider ?? "none"

  const [state, setState] = useState(() => freshTyped(scope))
  const typed = typedForScope(state, scope)
  const dispatch = (action: TypedAction): void => { setState((current) => reduceTyped(current, scope, action)) }
  const nameRef = useRef<HTMLInputElement>(null)

  const settledCui = useSettledValue(cuiLookupQuery(availability, typed.cui), LOOKUP_DEBOUNCE_MS)
  const cui = availability === undefined ? undefined : lookupTarget(typed, settledCui)
  const lookupRead = useQuery(companyLookupQuery(client, auth.csrfToken, provider, cui))
  const name = useSettledValue(nameSearchQuery(availability, typed.name), LOOKUP_DEBOUNCE_MS)
  const searchRead = useQuery(companySearchQuery(client, auth.csrfToken, provider, name))

  const lookup: CompanyLookupModel = {
    nameSearch: availability?.nameSearch === true,
    outcome: lookupOutcome(cui, lookupRead, typed.applied),
    suggestions: name === undefined ? NO_SUGGESTIONS : searchRead.data ?? NO_SUGGESTIONS,
    searchNote: searchNote(name, searchRead),
    typeCui: (value) => { dispatch({ kind: "type-cui", value }) },
    typeName: (value) => { dispatch({ kind: "type-name", value }) },
    pick: (suggestion) => { dispatch({ kind: "pick", cui: suggestion.cui }) },
    closeSuggestions: () => { dispatch({ kind: "close-suggestions" }) },
    applied: (proposal) => { dispatch({ kind: "applied", cui: proposal.cui }); nameRef.current?.focus() },
  }
  return { lookup, nameRef }
}
