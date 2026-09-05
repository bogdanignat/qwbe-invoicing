import { useMutation, useQueryClient } from "@tanstack/react-query"
import { runUiEffect } from "../api.ts"
import { formField, type FormSubmitEvent } from "../form.ts"
import { money, today } from "../format.ts"
import { invoiceActionState } from "../invoice-state.ts"
import { invoicingClient } from "../invoicing-client.ts"
import { useIdempotencyKey } from "../idempotency-key.ts"
import type { CorrectionDocument, PaymentSummary } from "../models.ts"
import { EmptyState, ErrorAlert } from "./AsyncState.tsx"
import { Button } from "./ui/Button.tsx"

interface CorrectionPanelProps {
  readonly invoiceId: string
  readonly corrections: ReadonlyArray<CorrectionDocument>
  readonly paymentSummary: PaymentSummary
  readonly notify: (message: string) => void
}

export const CorrectionPanel = ({ invoiceId, corrections, paymentSummary, notify }: CorrectionPanelProps) => {
  const queryClient = useQueryClient()
  const idempotency = useIdempotencyKey()
  const state = invoiceActionState(paymentSummary, corrections)
  const create = useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) => runUiEffect(invoicingClient.createCorrection(invoiceId, body, idempotency.current())),
    onSuccess: async () => { idempotency.complete(); await queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] }); notify("Documentul storno a fost emis.") },
    onError: idempotency.fail,
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    if (!window.confirm("Emiți un document storno integral? Documentul va fi fiscal și imuabil.")) return
    const form = event.currentTarget
    create.mutate({ reason: formField(form, "reason"), issueDate: formField(form, "issueDate") })
  }
  return <section className="card operation-card">
    <div className="section-heading"><div><p className="eyebrow">Corecții fiscale</p><h2>Documente storno</h2></div><span className="count">{corrections.length}</span></div>
    {corrections.length === 0 ? <EmptyState>Factura nu are documente de corecție.</EmptyState> : <ol className="record-list correction-list">{corrections.map((correction) => <li key={correction.id}><div><strong>Storno {correction.series} {correction.number}</strong><span>{correction.issueDate} · {money(correction.totalIncludingVat, correction.currency)}</span></div><p>{correction.reason}</p></li>)}</ol>}
    {create.error === null ? null : <ErrorAlert error={create.error} />}
    {state.canCreateFullCorrection ? <details className="operation-form"><summary>Creează document storno</summary><form onSubmit={submit}><label>Motivul corecției<textarea name="reason" rows={3} maxLength={500} required /></label><label>Data documentului<input name="issueDate" type="date" defaultValue={today()} required /></label><Button variant="danger" type="submit" disabled={create.isPending}>{create.isPending ? "Se emite…" : "Emite storno integral"}</Button><p className="hint">Se creează un document fiscal nou, imuabil, cu valorile facturii negate.</p></form></details> : <p className="status-note">Storno-ul integral a fost deja emis; nu poate fi duplicat.</p>}
  </section>
}
