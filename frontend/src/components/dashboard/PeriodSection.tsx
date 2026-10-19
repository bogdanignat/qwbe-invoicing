import { useId } from "react"

import { PeriodFilter } from "./PeriodFilter.tsx"
import { ReportFrame } from "./ReportFrame.tsx"
import { RevenueChart } from "./RevenueChart.tsx"
import { StatCards } from "./StatCards.tsx"
import type { DashboardModel } from "../../hooks/use-dashboard.ts"

/** The period block: its figures and chart follow the period only, never the status filter below. */
export const PeriodSection = ({ dashboard }: { readonly dashboard: DashboardModel }) => {
  const headingId = useId()
  const { filters, period } = dashboard
  return <section className="card" aria-labelledby={headingId} aria-busy={period.state.refreshing}>
    <div className="section-heading">
      <div>
        <h2 id={headingId}>Perioada</h2>
        <p>{dashboard.caption}</p>
      </div>
      {period.state.refreshing ? <span className="count" role="status">Se actualizează…</span> : null}
    </div>
    <PeriodFilter filters={filters} />
    <ReportFrame block={period} loading="Se încarcă cifrele perioadei…">
      {(view) => <>
        <StatCards label="Cifrele perioadei" cards={view.cards} />
        <RevenueChart months={view.months} currency={view.currency} />
      </>}
    </ReportFrame>
  </section>
}
