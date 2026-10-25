import { useInfiniteQuery } from "@tanstack/react-query"
import { useMemo } from "react"

import { useAuth } from "./auth-context.ts"
import { receivedListQuery } from "./received-queries.ts"
import { retryAction } from "./use-document-detail.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { efacturaFailure } from "../lib/efactura-feedback.ts"
import { pluginActive } from "../lib/plugins.ts"
import { projectReceivedRow, type ReceivedRow } from "../lib/received-projection.ts"

export interface ReceivedInvoicesModel {
  readonly rows: ReadonlyArray<ReceivedRow> | undefined
  readonly isPending: boolean
  /** Already in Romanian; a failed „load more” keeps the rows already on screen. */
  readonly error: Error | undefined
  readonly retry: (() => void) | undefined
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
}

/**
 * The received invoices, one cursor page at a time, as the issued register
 * pages (`use-invoice-register.ts`). With the e-Factura plugin off nothing is
 * asked and there is no model. A failed next page is retried from its cursor,
 * a failed first page by asking again.
 */
export const useReceivedInvoices = (): ReceivedInvoicesModel | undefined => {
  const auth = useAuth()
  const enabled = pluginActive(auth, "efactura")
  const { efacturaReceived } = useInvoicingClients()
  const query = useInfiniteQuery(receivedListQuery(efacturaReceived, enabled))
  const rows = useMemo(() => query.data?.pages.flatMap((page) => page.items).map(projectReceivedRow), [query.data])
  if (!enabled) return undefined
  return {
    rows,
    isPending: query.isPending,
    error: efacturaFailure(query.error),
    retry: retryAction(query.error, query.isFetchNextPageError ? () => { void query.fetchNextPage() } : () => { void query.refetch() }),
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => { void query.fetchNextPage() },
  }
}
