import { queryOptions, skipToken, type QueryClient } from "@tanstack/react-query"

import { invoiceRegisterQueryKey } from "./use-invoice-register.ts"
import { efacturaQueryKeys, type EFacturaClient } from "../lib/efactura-client.ts"
import { historyPollInterval } from "../lib/efactura-document.ts"
import type { SubmittedKind } from "../lib/efactura-submissions.ts"

/**
 * The e-Factura reads, apart so a test can subscribe to them and count what
 * they fetch. With the plugin off none is enabled, so its routes, absent then,
 * are never asked.
 *
 * The history is polled as `historyPollInterval` decides: closely until ANAF
 * decided, rarely while only its answer is fetched, then not at all. The candidates are asked only on demand, page by page: each one is
 * a call to ANAF, so a page already seen is kept for a minute instead of asked again.
 */
const CANDIDATES_STALE_MS = 60_000

export const efacturaConnectionQuery = (client: EFacturaClient, enabled: boolean) => queryOptions({
  queryKey: efacturaQueryKeys.connection,
  enabled,
  queryFn: ({ signal }) => client.connection(signal),
})

export const efacturaHistoryQuery = (client: EFacturaClient, kind: SubmittedKind, documentId: string, enabled: boolean) => queryOptions({
  queryKey: efacturaQueryKeys.history(kind, documentId),
  enabled,
  queryFn: ({ signal }) => client.history(kind, documentId, signal),
  refetchInterval: (query) => historyPollInterval(query.state.data),
})

export const efacturaCandidatesQuery = (client: EFacturaClient, submissionId: string | undefined, page: number) => queryOptions({
  queryKey: efacturaQueryKeys.candidates(submissionId ?? "", page),
  staleTime: CANDIDATES_STALE_MS,
  refetchOnMount: false,
  refetchOnReconnect: false,
  queryFn: submissionId === undefined ? skipToken : ({ signal }) => client.candidates(submissionId, page, signal),
})

/** The document's own status (the invoice head shows it) and the register's column. */
export const invalidateDocumentStatus = (queryClient: QueryClient, kind: SubmittedKind, documentId: string): void => {
  void queryClient.invalidateQueries({ queryKey: [kind, documentId], exact: true })
  void queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })
}

/** After a write: the history and the connection are asked again, and the status with them. */
export const invalidateEFacturaDocument = (queryClient: QueryClient, kind: SubmittedKind, documentId: string): void => {
  void queryClient.invalidateQueries({ queryKey: efacturaQueryKeys.history(kind, documentId) })
  void queryClient.invalidateQueries({ queryKey: efacturaQueryKeys.connection })
  invalidateDocumentStatus(queryClient, kind, documentId)
}
