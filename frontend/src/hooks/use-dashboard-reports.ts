import { useQuery, type UseQueryResult } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { collectionsQueryOptions, revenueQueryOptions } from "./report-queries.ts"
import { retryAction } from "./use-document-detail.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { usePluginEnabled } from "./use-plugin-enabled.ts"
import type { CollectionsReport, CollectionsStatus, RevenueReport } from "../lib/report-models.ts"
import type { ReportRange } from "../lib/report-period.ts"

export interface ReportState<Report> {
  /** The last answer; while `refreshing`, the one for the previous filters. */
  readonly data: Report | undefined
  readonly isPending: boolean
  readonly refreshing: boolean
  readonly error: unknown
  /** Present only when asking again could plausibly answer differently. */
  readonly retry: (() => void) | undefined
}

export interface DashboardReportsModel {
  readonly revenue: ReportState<RevenueReport>
  /** Undefined without the payments plugin: nothing is asked for and nothing is rendered. */
  readonly collections: ReportState<CollectionsReport> | undefined
}

const reportState = <Report>(query: UseQueryResult<Report>): ReportState<Report> => ({
  data: query.data,
  isPending: query.isPending,
  refreshing: query.isPlaceholderData,
  error: query.error,
  retry: retryAction(query.error, () => { void query.refetch() }),
})

/**
 * The two reports for the period on screen, each its own query: a failing
 * collections report leaves the revenue figures and chart standing, and the
 * status filter re-asks for collections only.
 */
export const useDashboardReports = (range: ReportRange, status: CollectionsStatus): DashboardReportsModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const payments = usePluginEnabled("payments")
  const revenue = useQuery(revenueQueryOptions(clients, range, auth.status === "authenticated"))
  const collections = useQuery(collectionsQueryOptions(clients, range, status, payments))
  return { revenue: reportState(revenue), collections: payments ? reportState(collections) : undefined }
}
