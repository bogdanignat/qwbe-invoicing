import { infiniteQueryOptions, queryOptions, type QueryClient } from "@tanstack/react-query"

import { receivedQueryKeys, type EFacturaReceivedClient } from "../lib/efactura-received-client.ts"
import { fetchFinished, statusPollInterval } from "../lib/received-fetch-progress.ts"
import type { ReceivedStatus } from "../lib/received-models.ts"

/**
 * The received-invoice reads, apart so a test can subscribe to them and count
 * what they fetch. With the plugin off none is enabled, so its routes, absent
 * then, are never asked.
 *
 * The status is polled only while a fetch is active (`statusPollInterval`):
 * the interval belongs to the page's observer, so leaving the page stops it.
 * The answer in which an active fetch is over invalidates the list, so the
 * invoices it stored appear without a reload.
 */
export const receivedListQuery = (client: EFacturaReceivedClient, enabled: boolean) => infiniteQueryOptions({
  queryKey: receivedQueryKeys.list,
  enabled,
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam, signal }) => client.list(pageParam === undefined ? undefined : { cursor: pageParam }, signal),
  getNextPageParam: (last) => last.nextCursor ?? undefined,
})

export const receivedStatusQuery = (client: EFacturaReceivedClient, queryClient: QueryClient, enabled: boolean) => queryOptions({
  queryKey: receivedQueryKeys.status,
  enabled,
  queryFn: async ({ signal }) => {
    const previous = queryClient.getQueryData<ReceivedStatus>(receivedQueryKeys.status)
    const next = await client.status(signal)
    if (fetchFinished(previous?.fetch, next.fetch)) void queryClient.invalidateQueries({ queryKey: receivedQueryKeys.list })
    return next
  },
  refetchInterval: (query) => statusPollInterval(query.state.data),
})

export const receivedDetailQuery = (client: EFacturaReceivedClient, id: string, enabled: boolean) => queryOptions({
  queryKey: receivedQueryKeys.detail(id),
  enabled,
  queryFn: ({ signal }) => client.detail(id, signal),
})
