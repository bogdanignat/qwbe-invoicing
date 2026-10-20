import { useId } from "react"

import type { ChartMonth } from "../../lib/dashboard-view.ts"
import { money } from "../../lib/money.ts"
import { chartDescription, revenueChartModel } from "../../lib/revenue-chart.ts"

interface RevenueChartProps {
  readonly months: ReadonlyArray<ChartMonth>
  readonly currency: string
}

/**
 * Grouped bars per month, drawn from `revenueChartModel`: this component maps
 * the geometry to SVG and decides nothing. For assistive technology the SVG is
 * one image with a name, and the exact amounts follow in a visually hidden table.
 */
export const RevenueChart = ({ months, currency }: RevenueChartProps) => {
  const captionId = useId()
  const chart = revenueChartModel(months, currency)
  return <figure className="revenue-chart">
    <div className="chart-scroll">
      <svg role="img" aria-label={chartDescription(months)} viewBox={`0 0 ${String(chart.width)} ${String(chart.height)}`}
        width={chart.width} height={chart.height}>
        {chart.ticks.map((tick) => <g key={tick.label} className="chart-tick">
          <line x1={chart.plotLeft} x2={chart.plotRight} y1={tick.y} y2={tick.y} />
          <text x={chart.plotLeft - 8} y={tick.y} dominantBaseline="middle" textAnchor="end">{tick.label}</text>
        </g>)}
        {chart.groups.map((group) => <g key={group.month}>
          {group.bars.map((bar) => <rect key={bar.key} className={`chart-bar ${bar.key}`}
            x={bar.x} y={bar.y} width={bar.width} height={bar.height}>
            <title>{bar.title}</title>
          </rect>)}
          <text className="chart-month" x={group.center} y={chart.height - 24} textAnchor="middle">{group.monthLabel}</text>
          {group.yearLabel === undefined
            ? null
            : <text className="chart-year" x={group.center} y={chart.height - 8} textAnchor="middle">{group.yearLabel}</text>}
        </g>)}
        <line className="chart-zero" x1={chart.plotLeft} x2={chart.plotRight} y1={chart.zeroY} y2={chart.zeroY} />
      </svg>
    </div>
    <figcaption id={captionId} className="chart-legend">
      {chart.series.map((series) => <span key={series.key}>
        <span className={`legend-swatch ${series.key}`} aria-hidden="true" />{series.label}
      </span>)}
      <span>Sume în {currency}, cu TVA</span>
    </figcaption>
    <table className="sr-only" aria-describedby={captionId}>
      <caption>Valorile graficului, pe luni</caption>
      <thead>
        <tr><th scope="col">Luna</th>{chart.series.map((series) => <th scope="col" key={series.key}>{series.label}</th>)}</tr>
      </thead>
      <tbody>
        {months.map((month) => <tr key={month.month}>
          <th scope="row">{month.label}</th>
          <td>{money(month.invoiced, currency)}</td>
          {month.collected === undefined ? null : <td>{money(month.collected, currency)}</td>}
        </tr>)}
      </tbody>
    </table>
  </figure>
}
