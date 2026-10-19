import { useId } from "react"

import { CollectionsTable } from "./CollectionsTable.tsx"
import { ReportFrame } from "./ReportFrame.tsx"
import { StatCards } from "./StatCards.tsx"
import { EmptyState } from "../AsyncState.tsx"
import { ChoiceGroup } from "../ui/ChoiceGroup.tsx"
import type { DashboardModel } from "../../hooks/use-dashboard.ts"
import { COLLECTIONS_STATUS_FILTERS } from "../../lib/dashboard-query.ts"

/**
 * The invoices issued in the period, filtered by today's payment status. Only
 * rendered with the payments plugin on; the status is the backend's, so the
 * storno limitation is stated rather than worked around.
 */
export const SituationSection = ({ dashboard }: { readonly dashboard: DashboardModel }) => {
  const headingId = useId()
  const { filters, situation } = dashboard
  if (situation === undefined) return null
  return <section className="card" aria-labelledby={headingId} aria-busy={situation.state.refreshing}>
    <div className="section-heading">
      <div>
        <h2 id={headingId}>Facturile emise în perioadă</h2>
        <p>Status și sold la zi, cu toate plățile facturii, indiferent de data lor.</p>
      </div>
      {situation.state.refreshing
        ? <span className="count" role="status">Se actualizează…</span>
        : situation.view === undefined ? null : <span className="count">{situation.view.count}</span>}
    </div>
    <div className="filters">
      <ChoiceGroup legend="Status încasare" choices={COLLECTIONS_STATUS_FILTERS}
        value={filters.query.status} onChange={filters.chooseStatus} />
    </div>
    <ReportFrame block={situation} loading="Se încarcă facturile perioadei…">
      {(view) => <>
        <StatCards label="Situația facturilor filtrate" cards={view.cards} />
        <p className="status-note">Storno-ul nu schimbă statusul facturii: o factură stornată apare în continuare cu soldul ei.</p>
        {view.rows.length === 0
          ? <EmptyState>Nicio factură din perioadă nu corespunde filtrului.</EmptyState>
          : <CollectionsTable rows={view.rows} />}
      </>}
    </ReportFrame>
  </section>
}
