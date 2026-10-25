import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { receivedStatusQuery } from "./received-queries.ts"
import { retryAction } from "./use-document-detail.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { SESSION_CLOSED } from "./use-registry-writes.ts"
import { receivedQueryKeys } from "../lib/efactura-received-client.ts"
import { efacturaFailure, receivedFetchFailure } from "../lib/efactura-feedback.ts"
import { pluginActive } from "../lib/plugins.ts"
import { coverageView, type CoverageView } from "../lib/received-coverage.ts"
import { fetchProgressView, type FetchProgressView } from "../lib/received-fetch-progress.ts"
import type { ReceivedStatus } from "../lib/received-models.ts"
import { sessionWrite } from "../lib/session-write.ts"

export interface ReceivedFetchModel {
  /** Undefined until the status is read. */
  readonly coverage: CoverageView | undefined
  /** The latest fetch: its progress while active, its result after. */
  readonly progress: FetchProgressView | undefined
  readonly statusError: Error | undefined
  readonly statusRetry: (() => void) | undefined
  /** A refused request (`409`, `403`), already in Romanian. */
  readonly failure: Error | undefined
  /** A request in flight or a fetch still active: „Preia din SPV” waits. */
  readonly busy: boolean
  readonly request: () => void
}

/**
 * „Preia din SPV”: asks the server for a fetch (`202`, or the one already
 * active), puts its answer in the status at once so polling starts, and lets
 * `receivedStatusQuery` follow it to the end and refresh the list. The browser
 * holds no grant list: without `efactura:receive` the server answers `403`,
 * shown as the plugin's sentence. With the plugin off there is no model.
 */
export const useReceivedFetch = (): ReceivedFetchModel | undefined => {
  const auth = useAuth()
  const enabled = pluginActive(auth, "efactura")
  const { efacturaReceived } = useInvoicingClients()
  const queryClient = useQueryClient()
  const status = useQuery(receivedStatusQuery(efacturaReceived, queryClient, enabled))
  const mutation = useMutation({
    mutationFn: async () => (await sessionWrite(auth, (token) => efacturaReceived.requestFetch(token), SESSION_CLOSED))?.value,
    onSuccess: (fetch) => {
      if (fetch === undefined) return
      queryClient.setQueryData<ReceivedStatus>(receivedQueryKeys.status, (old) => ({ fetch, coveredUntil: old?.coveredUntil ?? null }))
    },
  })
  if (!enabled) return undefined
  const data = status.data
  const progress = data?.fetch === null || data?.fetch === undefined ? undefined : fetchProgressView(data.fetch)
  const busy = mutation.isPending || progress?.active === true
  return {
    coverage: data === undefined ? undefined : coverageView(data.coveredUntil, new Date()),
    progress,
    statusError: efacturaFailure(status.error),
    statusRetry: retryAction(status.error, () => { void status.refetch() }),
    failure: receivedFetchFailure(mutation.error),
    busy,
    request: () => {
      if (busy) return
      mutation.mutate()
    },
  }
}
