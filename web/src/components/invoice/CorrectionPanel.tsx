import { money, today } from "../../lib/format.ts"
import { useCorrectionCreation } from "../../hooks/correction-hooks.ts"
import type { CorrectionDocument, PaymentSummary } from "../../lib/models.ts"
import { EmptyState, ErrorAlert } from "../layout/AsyncState.tsx"
import { Button } from "../ui/Button.tsx"

interface CorrectionPanelProps {
  readonly invoiceId: string
  readonly corrections: ReadonlyArray<CorrectionDocument>
  readonly paymentSummary: PaymentSummary
  readonly notify: (message: string) => void
}

export const CorrectionPanel = ({ invoiceId, corrections, paymentSummary, notify }: CorrectionPanelProps) => {
  const { state, create, submit } = useCorrectionCreation({ invoiceId, corrections, paymentSummary, notify })
  return <section className="card operation-card">
    <div className="section-heading"><div><p className="eyebrow">Corecții fiscale</p><h2>Documente storno</h2></div><span className="count">{corrections.length}</span></div>
    {corrections.length === 0 ? <EmptyState>Factura nu are documente de corecție.</EmptyState> : <ol className="record-list correction-list">{corrections.map((correction) => <li key={correction.id}><div><strong>Storno {correction.series} {correction.number}</strong><span>{correction.issueDate} · {money(correction.totalIncludingVat, correction.currency)}</span></div><p>{correction.reason}</p></li>)}</ol>}
    {create.error === null ? null : <ErrorAlert error={create.error} />}
    {state.canCreateFullCorrection ? <details className="operation-form"><summary>Creează document storno</summary><form onSubmit={submit}><label>Motivul corecției<textarea name="reason" rows={3} maxLength={300} required /></label><label>Data documentului<input name="issueDate" type="date" defaultValue={today()} required /></label><Button variant="danger" type="submit" disabled={create.isPending}>{create.isPending ? "Se emite…" : "Emite storno integral"}</Button><p className="hint">Se creează un document fiscal nou, imuabil, cu valorile facturii negate.</p></form></details> : <p className="status-note">Storno-ul integral a fost deja emis; nu poate fi duplicat.</p>}
  </section>
}
