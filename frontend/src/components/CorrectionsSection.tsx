"use client"

import Link from "next/link"

import { Button } from "./Button.tsx"
import { EmptyState, ErrorAlert, Loading } from "./AsyncState.tsx"
import { Field } from "./ui/Field.tsx"
import { Input } from "./ui/Input.tsx"
import { Textarea } from "./ui/Textarea.tsx"
import type { InvoiceCorrectionsModel } from "../hooks/use-invoice-corrections.ts"
import { CORRECTION_ALREADY_ISSUED_NOTE, CORRECTION_REASON_MAX_LENGTH } from "../lib/correction-state.ts"
import { ORGANIZATION_TIME_ZONE, todayIn } from "../lib/format.ts"

/**
 * The stornos of an issued invoice, rendered from the model: whether the form
 * is offered, what each row reads and what the server already settled are all
 * decided in `use-invoice-corrections.ts` and `correction-state.ts`.
 */
export const CorrectionsSection = ({ corrections }: { readonly corrections: InvoiceCorrectionsModel }) => {
  const { view } = corrections
  return <section className="card">
    <div className="section-heading">
      <div>
        <p className="eyebrow">Corecții fiscale</p>
        <h2>Documente storno</h2>
      </div>
    </div>
    {view === undefined
      ? corrections.isPending
        ? <Loading label="Se încarcă documentele storno…" />
        : <ErrorAlert error={corrections.error} onRetry={corrections.retry} />
      : <>
        {corrections.error === null || corrections.error === undefined
          ? null
          : <ErrorAlert error={corrections.error} onRetry={corrections.retry} />}
        {corrections.unconfirmedMessage === undefined
          ? null
          : <p className="status-note warning" role="alert">{corrections.unconfirmedMessage}</p>}
        {corrections.alreadyCorrected === undefined
          ? null
          : <p className="status-note warning" role="alert">{corrections.alreadyCorrected}</p>}
        {view.rows.length === 0
          ? <EmptyState>Factura nu are documente storno.</EmptyState>
          : <div>
            {view.rows.map((row) => <div className="draft-item" key={row.id}>
              <div className="draft-item-main">
                <Link href={row.href}><strong>{row.title}</strong></Link>
                <small>{row.caption}</small>
                <small>{row.reason}</small>
              </div>
            </div>)}
          </div>}
        {view.canIssue
          ? <details>
            <summary>Emite storno integral</summary>
            <form className="form-card" onSubmit={(event) => { event.preventDefault(); corrections.issue(new FormData(event.currentTarget)) }}>
              <div className="form-grid">
                <Field label="Motivul stornării" required className="span-two">
                  <Textarea name="reason" rows={3} maxLength={CORRECTION_REASON_MAX_LENGTH} required />
                </Field>
                <Field label="Data documentului" required>
                  <Input name="issueDate" type="date" defaultValue={todayIn(ORGANIZATION_TIME_ZONE)} required />
                </Field>
              </div>
              <p className="hint">Se creează un document fiscal nou, imuabil, cu valorile facturii negate.</p>
              <div className="button-row">
                <Button className="danger" type="submit" disabled={!corrections.canIssue}>
                  {corrections.pending ? "Se emite…" : "Emite storno integral"}
                </Button>
              </div>
            </form>
          </details>
          : <p className="status-note">{CORRECTION_ALREADY_ISSUED_NOTE}</p>}
      </>}
  </section>
}
