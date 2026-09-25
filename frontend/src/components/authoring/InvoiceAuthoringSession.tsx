"use client"

import Link from "next/link"

import type { InvoiceAuthoringSessionInput } from "../../hooks/invoice-authoring-session-types.ts"
import { useInvoiceAuthoringSession } from "../../hooks/use-invoice-authoring-session.ts"
import { InvoiceAuthoringHeader } from "./InvoiceAuthoringHeader.tsx"
import { InvoiceLinesEditor } from "./InvoiceLinesEditor.tsx"
import { InvoiceTotals } from "./InvoiceTotals.tsx"
import { AuthoringActions } from "./AuthoringActions.tsx"
import { OperationRecoveryNotice } from "./OperationRecoveryNotice.tsx"
import { Textarea } from "../ui/Textarea.tsx"
import { ErrorAlert } from "../AsyncState.tsx"

/**
 * The whole authoring form around one session view-model: header and buyer,
 * notes, lines, then the server's totals and the actions. The component only
 * renders what the session hook computed; save, issuance and deletion all live
 * behind its actions.
 */
export const InvoiceAuthoringSession = (input: InvoiceAuthoringSessionInput) => {
  const session = useInvoiceAuthoringSession(input)
  const { actions, document, feedback, status } = session
  return <>
    {feedback.backgroundErrors.map((issue, index) => <ErrorAlert key={`${issue.error.message}-${String(index)}`} error={issue.error} onRetry={issue.retry} />)}
    {feedback.mutationError === null || feedback.mutationError === undefined ? null : <ErrorAlert error={feedback.mutationError} />}
    <OperationRecoveryNotice
      notice={feedback.recoveryNotice} pending={status.recoveryPending}
      onReplay={actions.replayRecovery} onDismiss={actions.dismissRecovery}
    />
    {feedback.resumableSave
      ? <p className="status-note" role="status">Draftul a fost creat și păstrat în această pagină. Corectează eroarea și apasă din nou „Salvează draftul”; vor fi retrimise numai liniile rămase sau modificate.</p>
      : null}
    {feedback.unconfirmedMessage === undefined
      ? null
      : <p className="status-note warning" role="status">{feedback.unconfirmedMessage}{" "}<Link href="/invoices">Registrul de facturi</Link></p>}
    {feedback.issueUnconfirmedMessage === undefined
      ? null
      : <p className="status-note warning" role="status">{feedback.issueUnconfirmedMessage}{" "}<Link href="/invoices">Verifică registrul de facturi</Link></p>}
    {feedback.issuerWarning === undefined
      ? null
      : <p className="status-note warning" role="status">{feedback.issuerWarning} Salvarea draftului rămâne disponibilă; API-ul verifică emiterea.</p>}
    {feedback.staleTaxWarning === null ? null : <p className="status-note warning" role="status" aria-live="polite">{feedback.staleTaxWarning}</p>}
    <form className="authoring-layout" onSubmit={(event) => { event.preventDefault(); actions.save() }}>
      <div className="section-stack">
        <InvoiceAuthoringHeader session={session} />
        {feedback.dueDateIssue === null
          ? null
          : <p className="status-note warning" id="invoice-due-date-issue" role="status">{feedback.dueDateIssue} Draftul poate fi salvat fără scadență.</p>}
        <section className="card authoring-section">
          <label className="notes-field">Observații <span className="optional">opțional</span>
            <Textarea disabled={status.pending} maxLength={feedback.notesMaxLength} rows={3}
              aria-describedby="notes-status" aria-invalid={feedback.notesIssue !== null}
              value={document.form.notes} onChange={(event) => { actions.changeForm({ notes: event.currentTarget.value }) }} />
          </label>
          <p className={feedback.notesIssue === null ? "hint" : "hint warning"} id="notes-status" aria-live="polite">
            {feedback.notesIssue ?? `${String(document.form.notes.length)}/${String(feedback.notesMaxLength)}`}
          </p>
        </section>
        <InvoiceLinesEditor
          lines={document.lines} productPresets={document.productPresets}
          presetsHasMore={document.presetsHasMore} presetsLoadingMore={document.presetsLoadingMore}
          onPresetsLoadMore={document.presetsLoadMore}
          vatRates={document.vatRates} unitOfMeasures={document.unitOfMeasures} pending={status.pending}
          onAdd={actions.addLine} onChange={actions.changeLine} onApplyPreset={actions.choosePreset} onDelete={actions.deleteLine}
        />
      </div>
      <div className="authoring-side">
        <InvoiceTotals draft={document.draft} />
        <AuthoringActions session={session} />
      </div>
    </form>
  </>
}
