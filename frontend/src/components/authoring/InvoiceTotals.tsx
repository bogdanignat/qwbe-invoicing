"use client"

import { orDash } from "../../lib/format.ts"
import { vatTreatmentLabel } from "../../lib/vat-snapshots.ts"
import type { DraftInvoice } from "../../lib/draft-models.ts"

/**
 * The server's own totals for the draft as last saved. Nothing is computed
 * here on purpose: the preview is the backend's answer, so a fiscal rounding
 * rule lives in one place only, and an unsaved document shows no totals at all
 * rather than a local guess.
 */
export const InvoiceTotals = ({ draft }: { readonly draft: DraftInvoice | undefined }) => {
  if (draft === undefined) {
    return <section className="card authoring-section">
      <h2>Totaluri</h2>
      <p className="hint">Totalurile apar după prima salvare; serverul le calculează la fiecare salvare.</p>
    </section>
  }
  return <section className="card authoring-section">
    <h2>Totaluri</h2>
    <dl className="totals-list">
      <div><dt>Total fără TVA</dt><dd>{draft.totalExcludingVat} {draft.currency}</dd></div>
      {draft.vatBreakdown.map((entry) => <div key={`${entry.code}-${entry.vatBaseAmount}`}>
        <dt>{vatTreatmentLabel(entry)}</dt><dd>{entry.vatAmount} {draft.currency}</dd>
      </div>)}
      <div><dt>Total TVA</dt><dd>{draft.vatTotal} {draft.currency}</dd></div>
      <div className="grand-total"><dt>Total cu TVA</dt><dd>{draft.totalIncludingVat} {draft.currency}</dd></div>
      <div><dt>Scadență</dt><dd>{orDash(draft.dueDate)}</dd></div>
    </dl>
  </section>
}
