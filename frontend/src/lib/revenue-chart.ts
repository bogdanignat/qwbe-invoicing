import { barRect, chartScale, minorUnits, scaleY, tickLabel } from "./chart-scale.ts"
import { money } from "./money.ts"
import { monthAbbreviation, type ChartMonth } from "./dashboard-view.ts"

/**
 * The revenue chart as drawable geometry: grouped bars per month, invoiced
 * with VAT next to collected, both from the zero line.
 *
 * The SVG uses a viewBox in these units; the component only maps the model to
 * elements. Each bar carries the exact amount in its title, and the same
 * amounts go to the accessible table, so the pixel rounding of the bars is the
 * only place anything is approximated.
 */
export type ChartSeriesKey = "invoiced" | "collected"

export interface ChartSeries {
  readonly key: ChartSeriesKey
  readonly label: string
}

export interface ChartBar {
  readonly key: ChartSeriesKey
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly title: string
}

export interface ChartGroup {
  readonly month: string
  readonly center: number
  /** `oct.`; the year is written under the first month and every January. */
  readonly monthLabel: string
  readonly yearLabel: string | undefined
  readonly bars: ReadonlyArray<ChartBar>
}

export interface RevenueChartModel {
  readonly width: number
  readonly height: number
  readonly plotLeft: number
  readonly plotRight: number
  readonly zeroY: number
  readonly ticks: ReadonlyArray<{ readonly y: number; readonly label: string }>
  readonly series: ReadonlyArray<ChartSeries>
  readonly groups: ReadonlyArray<ChartGroup>
}

export const INVOICED_SERIES: ChartSeries = { key: "invoiced", label: "Facturat cu TVA" }
export const COLLECTED_SERIES: ChartSeries = { key: "collected", label: "Încasat" }

const HEIGHT = 260
const PLOT_TOP = 14
const PLOT_BOTTOM = 42
const AXIS = 76
const RIGHT = 12
const MIN_PLOT_WIDTH = 560
const MIN_GROUP = 44
const MAX_BAR = 28

const amountOf = (month: ChartMonth, key: ChartSeriesKey): string | undefined =>
  key === "invoiced" ? month.invoiced : month.collected

export const chartSeries = (months: ReadonlyArray<ChartMonth>): ReadonlyArray<ChartSeries> =>
  months.length > 0 && months.every((month) => month.collected !== undefined) ? [INVOICED_SERIES, COLLECTED_SERIES] : [INVOICED_SERIES]

export const revenueChartModel = (months: ReadonlyArray<ChartMonth>, currency: string): RevenueChartModel => {
  const series = chartSeries(months)
  const amounts = months.flatMap((month) => series.map((entry) => amountOf(month, entry.key) ?? "0.00"))
  const scale = chartScale(amounts)
  const plotHeight = HEIGHT - PLOT_TOP - PLOT_BOTTOM
  const group = Math.max(MIN_GROUP, MIN_PLOT_WIDTH / Math.max(months.length, 1))
  const bar = Math.min(MAX_BAR, (group * 0.72) / series.length)
  const y = (value: number): number => PLOT_TOP + scaleY(scale, value, plotHeight)
  return {
    width: AXIS + group * months.length + RIGHT,
    height: HEIGHT,
    plotLeft: AXIS,
    plotRight: AXIS + group * months.length,
    zeroY: y(0),
    ticks: scale.ticks.map((tick) => ({ y: y(tick), label: tickLabel(tick) })),
    series,
    groups: months.map((month, index) => {
      const center = AXIS + group * (index + 0.5)
      return {
        month: month.month,
        center,
        monthLabel: monthAbbreviation(month.month),
        yearLabel: index === 0 || month.month.endsWith("-01") ? month.month.slice(0, 4) : undefined,
        bars: series.map((entry, position) => {
          const amount = amountOf(month, entry.key) ?? "0.00"
          const rect = barRect(scale, minorUnits(amount), plotHeight)
          return {
            key: entry.key,
            x: center - (bar * series.length) / 2 + bar * position,
            y: PLOT_TOP + rect.y,
            width: bar,
            height: rect.height,
            title: `${entry.label}, ${month.label}: ${money(amount, currency)}`,
          }
        }),
      }
    }),
  }
}

/** The chart's accessible name; the exact values follow in the table. */
export const chartDescription = (months: ReadonlyArray<ChartMonth>): string => {
  const names = chartSeries(months).map((entry) => entry.label).join(" și ")
  const first = months[0]
  const last = months[months.length - 1]
  const span = first === undefined || last === undefined ? "" : `, ${first.label} – ${last.label}`
  return `Grafic pe luni: ${names}${span}. Valorile exacte sunt în tabelul următor.`
}
