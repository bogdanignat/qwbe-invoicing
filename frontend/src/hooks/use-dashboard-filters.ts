import { useLocation, useNavigate } from "@tanstack/react-router"
import { useMemo, useState } from "react"

import {
  dashboardHref, dashboardRange, parseDashboardQuery, type DashboardQuery, type PeriodChoice,
} from "../lib/dashboard-query.ts"
import {
  INITIAL_CUSTOM_RANGE, applyCustomRange, chooseCustomRange, customRangeView, editCustomRange,
} from "../lib/custom-range-state.ts"
import { ORGANIZATION_TIME_ZONE, todayIn } from "../lib/format.ts"
import type { CollectionsStatus } from "../lib/report-models.ts"
import type { ReportRange } from "../lib/report-period.ts"

export interface DashboardFiltersModel {
  readonly query: DashboardQuery
  /** The dates the reports are asked for: a preset resolved against today in Europe/Bucharest. */
  readonly range: ReportRange
  /** `custom` shows the inputs: an applied custom interval, or the choice made and not applied yet. */
  readonly periodChoice: PeriodChoice
  /** What the custom inputs show: the dates being typed, else the period on screen. */
  readonly customRange: ReportRange
  readonly customError: string | undefined
  readonly choosePeriod: (choice: PeriodChoice) => void
  readonly editCustom: (field: keyof ReportRange, value: string) => void
  readonly applyCustom: () => void
  readonly chooseStatus: (status: CollectionsStatus) => void
}

/**
 * The filters are the address: every change is a history entry, so Back and
 * Forward walk through them and a refresh lands where it was. What the address
 * cannot hold about the custom interval lives in `custom-range-state.ts`.
 */
export const useDashboardFilters = (): DashboardFiltersModel => {
  // The query string as the router holds it: plain text pairs (`lib/search-params.ts`), so the
  // address is read here with `dashboard-query.ts` and nothing in between reinterprets it.
  const search = useLocation({ select: (location) => location.searchStr })
  const query = useMemo(() => parseDashboardQuery(search), [search])
  const range = dashboardRange(query.period, todayIn(ORGANIZATION_TIME_ZONE))
  const [custom, setCustom] = useState(INITIAL_CUSTOM_RANGE)
  const shown = customRangeView(custom, search, range)
  const navigate = useNavigate()
  // A history entry per change, at the address `dashboardHref` writes, so Back and Forward walk the
  // filters. The page stays where it is: a filter changes the reports, it does not open a new page.
  const show = (next: DashboardQuery): void => { void navigate({ href: dashboardHref(next), resetScroll: false }) }
  return {
    query,
    range,
    periodChoice: shown.chosen || query.period.kind === "custom" ? "custom" : query.period.preset,
    customRange: shown.range,
    customError: shown.error,
    choosePeriod: (choice) => {
      if (choice === "custom") { setCustom(chooseCustomRange(custom, search)); return }
      show({ ...query, period: { kind: "preset", preset: choice } })
    },
    editCustom: (field, value) => { setCustom(editCustomRange(custom, search, shown.range, field, value)) },
    applyCustom: () => {
      const outcome = applyCustomRange(custom, search, shown.range)
      if (outcome.kind === "refused") { setCustom(outcome.state); return }
      show({ ...query, period: { kind: "custom", range: outcome.range } })
    },
    chooseStatus: (status) => { show({ ...query, status }) },
  }
}
