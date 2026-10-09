"use client"

import { Button } from "./Button.tsx"
import { EmptyState, ErrorAlert, Loading } from "./AsyncState.tsx"
import { Field } from "./ui/Field.tsx"
import { Input } from "./ui/Input.tsx"
import { Select } from "./ui/Select.tsx"
import { Textarea } from "./ui/Textarea.tsx"
import type { InvoicePaymentsModel } from "../hooks/use-invoice-payments.ts"
import { ORGANIZATION_TIME_ZONE, todayIn } from "../lib/format.ts"
import { PAYMENT_METHODS } from "../lib/payment-state.ts"

/**
 * The payments of an issued invoice, rendered from the model: which rows may
 * be reversed, whether the form is offered and what the totals read are all
 * decided in `payment-state.ts`. The form is uncontrolled and keyed on the
 * paid amount, so every recorded payment remounts it with the new balance as
 * its default instead of the one it was first rendered with.
 */
export const PaymentsSection = ({ payments }: { readonly payments: InvoicePaymentsModel }) => {
  const { view } = payments
  return <section className="card">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Încasări</p>
        <h2>Plăți</h2>
      </div>
      {view === undefined
        ? null
        : <span className={`badge ${view.statusTone}`}>{view.statusLabel}</span>}
    </div>
    {view === undefined
      ? payments.isPending
        ? <Loading label="Se încarcă plățile…" />
        : <ErrorAlert error={payments.error} onRetry={payments.retry} />
      : <>
        <dl className="payment-totals">
          <div><dt>Încasat</dt><dd>{view.paid}</dd></div>
          <div><dt>Rămas</dt><dd>{view.remaining}</dd></div>
        </dl>
        {payments.notice === undefined ? null : <p className="status-note" role="status">{payments.notice}</p>}
        {payments.error === null || payments.error === undefined
          ? null
          : <ErrorAlert error={payments.error} onRetry={payments.retry} />}
        {view.rows.length === 0
          ? <EmptyState>Nu există plăți înregistrate.</EmptyState>
          : <div>
            {view.rows.map((row) => <div className={row.isReversal ? "draft-item reversal" : "draft-item"} key={row.id}>
              <div className="draft-item-main">
                <strong>{row.amount}</strong>
                <small>{row.caption}</small>
                {row.reference === undefined ? null : <small>{row.reference}</small>}
                {row.note === undefined ? null : <small>{row.note}</small>}
              </div>
              {row.canReverse
                ? <div className="draft-item-actions">
                  <Button className="secondary small" aria-label={row.reverseLabel} disabled={payments.pending} onClick={() => { payments.reverse(row.id) }}>
                    Anulează
                  </Button>
                </div>
                : null}
            </div>)}
          </div>}
        {view.isOverpaid
          ? <p className="status-note warning">Încasările înregistrate depășesc totalul facturii. Nu mai pot fi adăugate plăți.</p>
          : null}
        {view.canRecordPayment
          ? <details>
            <summary>Înregistrează o plată</summary>
            <form className="form-card" key={view.formKey} onSubmit={(event) => { event.preventDefault(); payments.record(new FormData(event.currentTarget)) }}>
              <div className="form-grid">
                <Field label="Sumă" required>
                  <Input name="amount" inputMode="decimal" defaultValue={view.remainingAmount} required />
                </Field>
                <Field label="Data plății" required>
                  <Input name="paymentDate" type="date" defaultValue={todayIn(ORGANIZATION_TIME_ZONE)} required />
                </Field>
                <Field label="Metodă" required>
                  <Select name="method" defaultValue="transfer" required>
                    {PAYMENT_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                  </Select>
                </Field>
                <Field label="Referință" optional>
                  <Input name="externalReference" />
                </Field>
                <Field label="Notă" optional className="span-two">
                  <Textarea name="note" rows={2} />
                </Field>
              </div>
              <div className="button-row">
                <Button type="submit" disabled={payments.pending}>{payments.pending ? "Se salvează…" : "Salvează plata"}</Button>
              </div>
            </form>
          </details>
          : view.isOverpaid ? null : <p className="status-note">Soldul facturii este închis; nu mai sunt necesare plăți.</p>}
      </>}
  </section>
}
