import { decodeCollectionsReport, decodeRevenueReport } from "./report-decoders.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type { CollectionsReport, CollectionsStatus, RevenueReport } from "./report-models.ts"
import type { ReportRange } from "./report-period.ts"

/**
 * The dashboard's two reads. `collections` belongs to the payments plugin: its
 * route exists only while the plugin runs, so the caller decides whether to ask.
 */
export interface ReportsClient {
  readonly revenue: (range: ReportRange, signal: AbortSignal) => Promise<RevenueReport>
  readonly collections: (range: ReportRange, status: CollectionsStatus, signal: AbortSignal) => Promise<CollectionsReport>
}

const query = (entries: Readonly<Record<string, string>>): string => new URLSearchParams(entries).toString()

export const createReportsClient = (transport: BrowserTransport): ReportsClient => ({
  revenue: async (range, signal) =>
    decodeRevenueReport(await transport.json(`/api/reports/revenue?${query({ from: range.from, to: range.to })}`, { signal })),
  collections: async (range, status, signal) => decodeCollectionsReport(await transport.json(
    `/api/reports/collections?${query({ from: range.from, to: range.to, status })}`, { signal },
  )),
})
