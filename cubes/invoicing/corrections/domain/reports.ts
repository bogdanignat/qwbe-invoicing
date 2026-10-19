/** An inclusive calendar interval, YYYY-MM-DD at both ends. */
export interface ReportPeriod { readonly from: string; readonly to: string }

export const maximumReportMonths = 36

const isCalendarDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value)
  if (match === null) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

const monthIndex = (date: string): number => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1
const monthCount = (period: ReportPeriod): number => monthIndex(period.to) - monthIndex(period.from) + 1

/** Empty when the period is valid; shared by every report so the rule lives in one place. */
export const reportPeriodIssues = (period: ReportPeriod): ReadonlyArray<string> => {
  const issues = (["from", "to"] as const).filter((field) => !isCalendarDate(period[field]))
    .map((field) => `${field} must be a calendar date in YYYY-MM-DD format`)
  if (issues.length > 0) return issues
  if (period.from > period.to) return ["from must not be after to"]
  if (monthCount(period) > maximumReportMonths) return [`the period must span at most ${String(maximumReportMonths)} calendar months`]
  return []
}

/** Every calendar month the period touches, as YYYY-MM, oldest first. */
export const reportMonths = (period: ReportPeriod): ReadonlyArray<string> =>
  Array.from({ length: monthCount(period) }, (_, offset) => {
    const index = monthIndex(period.from) + offset
    return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String(index % 12 + 1).padStart(2, "0")}`
  })

/** Fills the months without data from `empty`, so a chart always gets a continuous series. */
export const continuousMonths = <Row extends { readonly month: string }>(
  period: ReportPeriod, rows: ReadonlyArray<Row>, empty: (month: string) => Row,
): ReadonlyArray<Row> => reportMonths(period).map((month) => rows.find((row) => row.month === month) ?? empty(month))

export interface RevenueFigures {
  readonly revenueExcludingVat: string
  readonly invoicedIncludingVat: string
  readonly invoiceCount: number
  readonly correctionCount: number
}
export interface RevenueMonth extends RevenueFigures { readonly month: string }

/** What the store aggregates: the months that have documents, and the totals of the whole period. */
export interface RevenueAggregate {
  readonly months: ReadonlyArray<RevenueMonth>
  readonly totals: RevenueFigures
}

export interface RevenueReport extends ReportPeriod, RevenueAggregate { readonly currency: "RON" }

const noRevenue = (month: string): RevenueMonth =>
  ({ month, revenueExcludingVat: "0.00", invoicedIncludingVat: "0.00", invoiceCount: 0, correctionCount: 0 })

export const revenueReport = (period: ReportPeriod, aggregate: RevenueAggregate): RevenueReport => ({
  from: period.from, to: period.to, currency: "RON",
  months: continuousMonths(period, aggregate.months, noRevenue), totals: aggregate.totals,
})
