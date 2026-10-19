import type { StatCard } from "../../lib/dashboard-view.ts"

/** A row of figures; each card is a term and its value, so a screen reader reads them as pairs. */
export const StatCards = ({ cards, label }: { readonly cards: ReadonlyArray<StatCard>; readonly label: string }) =>
  <dl className="stat-cards" aria-label={label}>
    {cards.map((card) => <div className="stat-card" key={card.key}>
      <dt>{card.label}</dt>
      <dd className="stat-value">{card.value}</dd>
      {card.hint === undefined ? null : <dd className="stat-hint">{card.hint}</dd>}
    </div>)}
  </dl>
