import { COLLECTIONS_STATUSES, type CollectionsStatus } from "./report-models.ts"
import {
  DEFAULT_PERIOD_PRESET, PERIOD_PRESETS, presetRange, rangeIssue, type PeriodPreset, type ReportRange,
} from "./report-period.ts"

/**
 * The dashboard's filters live in the address, so a refresh, a shared link and
 * Back/Forward all land on the same view: `?preset=6m`, or `?from=…&to=…` for a
 * custom interval, plus `?status=` for the invoices block.
 *
 * Parsing never fails. Whatever the address holds that is not a valid filter —
 * an unknown preset, half an interval, an interval the backend would refuse, an
 * unknown status — reads as the default, and serializing writes the defaults as
 * nothing, so one view has exactly one address.
 */
export type DashboardPeriod =
  | { readonly kind: "preset"; readonly preset: PeriodPreset }
  | { readonly kind: "custom"; readonly range: ReportRange }

export interface DashboardQuery {
  readonly period: DashboardPeriod
  readonly status: CollectionsStatus
}

export const DEFAULT_DASHBOARD_QUERY: DashboardQuery = {
  period: { kind: "preset", preset: DEFAULT_PERIOD_PRESET },
  status: "all",
}

export const COLLECTIONS_STATUS_FILTERS: ReadonlyArray<{ readonly value: CollectionsStatus; readonly label: string }> = [
  { value: "all", label: "Toate" },
  { value: "paid", label: "Încasate" },
  { value: "unpaid", label: "Neîncasate" },
  { value: "overdue", label: "Restante" },
]

/** The period radio group: the presets, then the custom interval. */
export type PeriodChoice = PeriodPreset | "custom"
export const PERIOD_CHOICES: ReadonlyArray<{ readonly value: PeriodChoice; readonly label: string }> = [
  ...PERIOD_PRESETS,
  { value: "custom", label: "Interval personalizat" },
]

const oneOf = <Value extends string>(allowed: ReadonlyArray<Value>, value: string | null): Value | undefined =>
  allowed.find((candidate) => candidate === value)

const parsePeriod = (params: URLSearchParams): DashboardPeriod => {
  const range = { from: params.get("from") ?? "", to: params.get("to") ?? "" }
  if (rangeIssue(range) === undefined) return { kind: "custom", range }
  const preset = oneOf(PERIOD_PRESETS.map((entry) => entry.value), params.get("preset"))
  return { kind: "preset", preset: preset ?? DEFAULT_PERIOD_PRESET }
}

export const parseDashboardQuery = (search: string): DashboardQuery => {
  const params = new URLSearchParams(search)
  return {
    period: parsePeriod(params),
    status: oneOf(COLLECTIONS_STATUSES, params.get("status")) ?? DEFAULT_DASHBOARD_QUERY.status,
  }
}

/** The query string without `?`; empty for the default view. */
export const serializeDashboardQuery = (query: DashboardQuery): string => {
  const params = new URLSearchParams()
  if (query.period.kind === "custom") {
    params.set("from", query.period.range.from)
    params.set("to", query.period.range.to)
  } else if (query.period.preset !== DEFAULT_PERIOD_PRESET) {
    params.set("preset", query.period.preset)
  }
  if (query.status !== DEFAULT_DASHBOARD_QUERY.status) params.set("status", query.status)
  return params.toString()
}

/** The address of a view: `/` for the defaults. */
export const dashboardHref = (query: DashboardQuery): string => {
  const search = serializeDashboardQuery(query)
  return search === "" ? "/" : `/?${search}`
}

/** The dates the reports are asked for; a preset ends on `today`, read in the organization's zone. */
export const dashboardRange = (period: DashboardPeriod, today: string): ReportRange =>
  period.kind === "custom" ? period.range : presetRange(period.preset, today)
