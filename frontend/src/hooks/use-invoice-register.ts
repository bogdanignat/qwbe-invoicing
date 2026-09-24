import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { isTransientFailure } from "../lib/api-errors.ts"
import {
  emptyRegisterFilter, filterInvoiceRegisterRows, projectInvoiceRegisterRow,
  type InvoiceRegisterPresentationRow, type RegisterFilter, type RegisterKindFilter,
} from "../lib/invoice-register-projection.ts"

export const invoiceRegisterQueryKey = ["invoice-register"] as const

export interface InvoiceRegisterModel {
  readonly rows: ReadonlyArray<InvoiceRegisterPresentationRow> | undefined
  readonly totalLoaded: number
  readonly error: unknown
  /** Present only when asking again could plausibly answer differently. */
  readonly retry: (() => void) | undefined
  readonly isPending: boolean
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly filter: RegisterFilter
  readonly setKind: (kind: RegisterKindFilter) => void
  readonly setSearch: (search: string) => void
}

/**
 * Whether to offer a retry, and which page it should ask for again.
 *
 * The query client runs with `retry: false` and `refetchOnWindowFocus: false`,
 * so a `502` on the register stays on screen until someone asks again; the
 * classification is the same `isTransientFailure` the document detail uses, so
 * a `404` is not offered a button that would only repeat the answer.
 *
 * Which call recovers depends on the page that failed. `refetch` replays every
 * loaded page, which is the only way back when the first one never arrived;
 * for a failed "load more" it would re-ask for rows already on screen, so that
 * case goes through `fetchNextPage` and appends where the cursor stopped.
 * `isFetchNextPageError` names the phase directly — `data` is kept on failure,
 * so neither call discards what is already loaded.
 */
const retryAction = (
  error: unknown,
  failedPage: "next" | "first",
  refetch: () => void,
  fetchNextPage: () => void,
): (() => void) | undefined => {
  if (!isTransientFailure(error)) return undefined
  return failedPage === "next" ? fetchNextPage : refetch
}

/**
 * The register, one cursor page at a time, for the authenticated shell only.
 *
 * `enabled` is tied to the session status rather than left on: a view still
 * mounted while the redirect to `/unlock` commits would otherwise keep asking
 * for private data and collect a `401` for a session that has already ended.
 * The fetch takes the query's own `signal`, so leaving the session aborts the
 * request in flight instead of writing its answer into a cleared cache.
 */
export const useInvoiceRegister = (): InvoiceRegisterModel => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const [filter, setFilter] = useState<RegisterFilter>(emptyRegisterFilter)
  const query = useInfiniteQuery({
    queryKey: invoiceRegisterQueryKey,
    enabled: status === "authenticated",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      clients.register.list(pageParam === undefined ? undefined : { cursor: pageParam }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const loaded = useMemo(() => query.data?.pages.flatMap((page) => page.items), [query.data])
  const rows = useMemo(
    () => loaded === undefined ? undefined : filterInvoiceRegisterRows(loaded, filter).map(projectInvoiceRegisterRow),
    [loaded, filter],
  )
  return {
    rows,
    totalLoaded: loaded?.length ?? 0,
    error: query.error,
    retry: retryAction(
      query.error,
      query.isFetchNextPageError ? "next" : "first",
      () => { void query.refetch() },
      () => { void query.fetchNextPage() },
    ),
    isPending: query.isPending,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => { void query.fetchNextPage() },
    filter,
    setKind: (kind) => { setFilter((current) => ({ ...current, kind })) },
    setSearch: (search) => { setFilter((current) => ({ ...current, search })) },
  }
}
