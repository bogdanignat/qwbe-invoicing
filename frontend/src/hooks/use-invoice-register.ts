import { keepPreviousData, useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { usePluginEnabled } from "./use-plugin-enabled.ts"
import { useRegisterFilters, type RegisterFiltersModel } from "./use-register-filters.ts"
import { isTransientFailure } from "../lib/api-errors.ts"
import { projectInvoiceRegisterRow, type InvoiceRegisterPresentationRow } from "../lib/invoice-register-projection.ts"

export const invoiceRegisterQueryKey = ["invoice-register"] as const

export interface InvoiceRegisterModel {
  readonly rows: ReadonlyArray<InvoiceRegisterPresentationRow> | undefined
  /** The rows on screen answer the previous filters while the new ones are being asked for. */
  readonly refreshing: boolean
  /** The e-Factura status column, only with that plugin on. */
  readonly eFacturaColumn: boolean
  readonly error: unknown
  /** Present only when asking again could plausibly answer differently. */
  readonly retry: (() => void) | undefined
  readonly isPending: boolean
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly filters: RegisterFiltersModel
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
 *
 * The filters are part of the key: every change is a new query from the first
 * page, filtered by the server. The previous answer stays on screen
 * (`keepPreviousData`) until the new one arrives, so the filters and the focus
 * in them are not replaced by a loading state at every keystroke.
 */
export const useInvoiceRegister = (): InvoiceRegisterModel => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const eFacturaColumn = usePluginEnabled("efactura")
  const filters = useRegisterFilters()
  const query = useInfiniteQuery({
    queryKey: [...invoiceRegisterQueryKey, filters.query],
    enabled: status === "authenticated",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => clients.register.list(filters.query, pageParam, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  })
  const rows = useMemo(
    () => query.data?.pages.flatMap((page) => page.items).map(projectInvoiceRegisterRow),
    [query.data],
  )
  return {
    rows,
    refreshing: query.isPlaceholderData,
    eFacturaColumn,
    error: query.error,
    retry: retryAction(
      query.error,
      query.isFetchNextPageError ? "next" : "first",
      () => { void query.refetch() },
      () => { void query.fetchNextPage() },
    ),
    isPending: query.isPending,
    hasMore: query.hasNextPage && !query.isPlaceholderData,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => { void query.fetchNextPage() },
    filters,
  }
}
