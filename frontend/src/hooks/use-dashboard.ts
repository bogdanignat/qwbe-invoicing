import { useDashboardFilters, type DashboardFiltersModel } from "./use-dashboard-filters.ts"
import { useDashboardReports, type ReportState } from "./use-dashboard-reports.ts"
import { situationView, type SituationView } from "../lib/dashboard-situation.ts"
import { periodCaption, periodView, type PeriodView } from "../lib/dashboard-view.ts"
import type { CollectionsReport, RevenueReport } from "../lib/report-models.ts"

export interface ReportBlock<Report, View> {
  readonly state: ReportState<Report>
  /** Absent until the report has answered once. */
  readonly view: View | undefined
}

export interface DashboardModel {
  readonly filters: DashboardFiltersModel
  readonly caption: string
  readonly period: ReportBlock<RevenueReport, PeriodView>
  /** Undefined without the payments plugin: no status block at all. */
  readonly situation: ReportBlock<CollectionsReport, SituationView> | undefined
}

/** The home screen: the filters from the address, the two reports for them, projected for rendering. */
export const useDashboard = (): DashboardModel => {
  const filters = useDashboardFilters()
  const { revenue, collections } = useDashboardReports(filters.range, filters.query.status)
  const collected = collections === undefined
    ? undefined
    : { report: collections.data, failed: collections.error !== null && collections.data === undefined }
  return {
    filters,
    caption: periodCaption(filters.range, collections !== undefined),
    period: { state: revenue, view: revenue.data === undefined ? undefined : periodView(revenue.data, collected) },
    situation: collections === undefined
      ? undefined
      : { state: collections, view: collections.data === undefined ? undefined : situationView(collections.data) },
  }
}
