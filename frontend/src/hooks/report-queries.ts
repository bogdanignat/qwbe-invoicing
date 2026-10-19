import { keepPreviousData, queryOptions, type QueryClient } from "@tanstack/react-query"

import { invoiceRegisterQueryKey } from "./use-invoice-register.ts"
import type { InvoicingClients } from "./use-invoicing-clients.ts"
import type { CollectionsStatus } from "../lib/report-models.ts"
import type { ReportRange } from "../lib/report-period.ts"

/**
 * The dashboard's two reads and the writes that make them stale.
 *
 * Revenue is keyed by the interval alone: the status filter does not touch it,
 * so switching the filter asks for collections only. Both keep the previous
 * answer while the next one loads, so the screen does not collapse to a spinner
 * on every filter change; the view checks the period before drawing it.
 */
export const reportsQueryKey = ["reports"] as const
const collectionsQueryPrefix = ["reports", "collections"] as const

export const revenueQueryOptions = (clients: Pick<InvoicingClients, "reports">, range: ReportRange, enabled: boolean) => queryOptions({
  queryKey: ["reports", "revenue", range.from, range.to],
  enabled,
  placeholderData: keepPreviousData,
  queryFn: ({ signal }) => clients.reports.revenue(range, signal),
})

/** `enabled` only with the payments plugin on: without it the route does not exist. */
export const collectionsQueryOptions = (
  clients: Pick<InvoicingClients, "reports">, range: ReportRange, status: CollectionsStatus, enabled: boolean,
) => queryOptions({
  queryKey: [...collectionsQueryPrefix, range.from, range.to, status],
  enabled,
  placeholderData: keepPreviousData,
  queryFn: ({ signal }) => clients.reports.collections(range, status, signal),
})

/** An invoice or a storno was issued (or may have been): the register and both reports are re-read. */
export const invalidateIssuedDocuments = (queryClient: QueryClient): void => {
  void queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })
  void queryClient.invalidateQueries({ queryKey: reportsQueryKey })
}

/** A payment or its reversal moves the collections only; revenue does not depend on payments. */
export const invalidateCollections = (queryClient: QueryClient): void => {
  void queryClient.invalidateQueries({ queryKey: collectionsQueryPrefix })
}
