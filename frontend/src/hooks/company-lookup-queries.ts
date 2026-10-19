import { queryOptions, skipToken } from "@tanstack/react-query"

import { companyLookupQueryKeys, type CompanyLookupClient } from "../lib/company-lookup-client.ts"
import type { LookupProvider } from "../lib/company-lookup-settings.ts"
import { requireCsrf } from "../lib/require-csrf.ts"

/**
 * The three reads behind the company-lookup forms, apart so a test can
 * subscribe to them and count what they fetch.
 *
 * None retries, and a lookup or search is never sent again on its own — not on
 * a remount, not on a reconnect: a refused or failed one (a `429` above all) is
 * shown, not repeated, until the user types another query. An answer
 * stays fresh for a day, as long as the backend's own cache keeps it, so going
 * back to a CUI already asked costs nothing. The provider is part of the key:
 * an answer from the provider switched off is never shown for the new one.
 * Without a query (`undefined`) the read is skipped and nothing leaves.
 */
const AVAILABILITY_STALE_MS = 5 * 60_000
const ANSWER_STALE_MS = 24 * 60 * 60_000
const ANSWER_GC_MS = 30 * 60_000
const ASKED_ONCE = { retry: false, retryOnMount: false, refetchOnMount: false, refetchOnReconnect: false } as const

export const companyLookupAvailabilityQuery = (client: CompanyLookupClient, enabled: boolean) => queryOptions({
  queryKey: companyLookupQueryKeys.availability,
  enabled,
  retry: false,
  staleTime: AVAILABILITY_STALE_MS,
  queryFn: ({ signal }) => client.availability(signal),
})

export const companyLookupQuery = (
  client: CompanyLookupClient, csrfToken: () => string | undefined, provider: LookupProvider, cui: string | undefined,
) => queryOptions({
  queryKey: [...companyLookupQueryKeys.lookup, provider, cui ?? ""],
  ...ASKED_ONCE,
  staleTime: ANSWER_STALE_MS,
  gcTime: ANSWER_GC_MS,
  queryFn: cui === undefined ? skipToken : ({ signal }) => client.lookup(requireCsrf(csrfToken()), cui, signal),
})

export const companySearchQuery = (
  client: CompanyLookupClient, csrfToken: () => string | undefined, provider: LookupProvider, name: string | undefined,
) => queryOptions({
  queryKey: [...companyLookupQueryKeys.search, provider, name ?? ""],
  ...ASKED_ONCE,
  staleTime: ANSWER_STALE_MS,
  gcTime: ANSWER_GC_MS,
  queryFn: name === undefined ? skipToken : ({ signal }) => client.search(requireCsrf(csrfToken()), name, signal),
})
