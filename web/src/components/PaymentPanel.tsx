import { useMutation, useQueryClient } from "@tanstack/react-query"
import { runUiEffect } from "../api.ts"
import { formField, type FormSubmitEvent } from "../form.ts"
import { money, today } from "../format.ts"
import { invoiceActionState } from "../invoice-state.ts"
import { invoicingClient } from "../invoicing-client.ts"
import type { CorrectionDocument, PaymentSummary } from "../models.ts"
import { EmptyState, ErrorAlert } from "./AsyncState.tsx"
import { Button } from "./ui/Button.tsx"

const labels: Readonly<Record<PaymentSummary["status"], string>> = {
  unpaid: "Neplătită", partially_paid: "Plătită parțial", paid: "Plătită", overpaid: "Plătită în exces", overdue: "Scadentă",
}

interface PaymentPanelProps {
  readonly invoiceId: string
  readonly currency: string
  readonly summary: PaymentSummary
  readonly corrections: ReadonlyArray<CorrectionDocument>
  readonly notify: (message: string) => void
}

export const PaymentPanel = ({ invoiceId, currency, summary, corrections, notify }: PaymentPanelProps) => {
  const queryClient = useQueryClient()
  const state = invoiceActionState(summary, corrections)
  const record = useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) => runUiEffect(invoicingClient.recordPayment(invoiceId, body)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] }); notify("Plata a fost înregistrată.") },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const externalReference = formField(form, "externalReference")
    const note = formField(form, "note")
    record.mutate({ amount: formField(form, "amount"), currency, paymentDate: formField(form, "paymentDate"), method: formField(form, "method"), ...(externalReference === "" ? {} : { externalReference }), ...(note === "" ? {} : { note }) })
  }
  return <section className="card operation-card">
    <div className="section-heading"><div><p className="eyebrow">Încasări</p><h2>Plăți</h2></div><span className={`badge payment-${summary.status}`}>{labels[summary.status]}</span></div>
    <dl className="payment-totals"><div><dt>Încasat</dt><dd>{money(summary.paidAmount, currency)}</dd></div><div><dt>Rămas</dt><dd>{money(summary.remainingAmount, currency)}</dd></div></dl>
    {summary.payments.length === 0 ? <EmptyState>Nu există plăți înregistrate.</EmptyState> : <ol className="record-list">{summary.payments.map((payment) => <li key={payment.id}><div><strong>{money(payment.amount, payment.currency)}</strong><span>{payment.method} · {payment.paymentDate}</span></div>{payment.externalReference === undefined ? null : <small>Ref. {payment.externalReference}</small>}{payment.note === undefined ? null : <p>{payment.note}</p>}</li>)}</ol>}
    {state.isOverpaid ? <p className="status-note warning">Încasările înregistrate depășesc totalul facturii. Nu mai pot fi adăugate plăți.</p> : null}
    {record.error === null ? null : <ErrorAlert error={record.error} />}
    {state.canRecordPayment ? <details className="operation-form"><summary>Înregistrează o plată</summary><form key={summary.paidAmount} onSubmit={submit}>
      <div className="form-grid two"><label>Sumă<input name="amount" inputMode="decimal" defaultValue={summary.remainingAmount} required /></label><label>Data plății<input name="paymentDate" type="date" defaultValue={today()} required /></label><label>Metodă<select name="method" required defaultValue="transfer"><option value="transfer">Transfer bancar</option><option value="card">Card</option><option value="cash">Numerar</option><option value="other">Alta</option></select></label><label>Referință <span className="optional">opțional</span><input name="externalReference" /></label><label className="span-two">Notă <span className="optional">opțional</span><textarea name="note" rows={2} /></label></div>
      <Button type="submit" disabled={record.isPending}>{record.isPending ? "Se salvează…" : "Salvează plata"}</Button>
    </form></details> : state.isOverpaid ? null : <p className="status-note">Soldul facturii este închis; nu mai sunt necesare plăți.</p>}
  </section>
}
