"use client"

import Link from "next/link"

import type { ProformaAuthoringSessionInput } from "../../hooks/proforma-authoring-session-types.ts"
import { useProformaAuthoringSession } from "../../hooks/use-proforma-authoring-session.ts"
import { InvoiceLinesEditor } from "./InvoiceLinesEditor.tsx"
import { OperationRecoveryNotice } from "./OperationRecoveryNotice.tsx"
import { ProformaAuthoringActions } from "./ProformaAuthoringActions.tsx"
import { ProformaAuthoringHeader } from "./ProformaAuthoringHeader.tsx"
import { Textarea } from "../ui/Textarea.tsx"
import { ErrorAlert } from "../AsyncState.tsx"

/**
 * The proforma form around one session view-model: head and buyer, notes, lines,
 * then the single save.
 *
 * There is no draft and no issuance step here, so an unconfirmed write is a
 * dead end by design: the notice sends the user to the register to check whether
 * the proforma exists instead of offering a second save under a new key.
 */
export const ProformaAuthoringSession = (input: ProformaAuthoringSessionInput) => {
  const session = useProformaAuthoringSession(input)
  const { actions, document, feedback, status } = session
  return <>
    {feedback.backgroundErrors.map((issue, index) => <ErrorAlert key={`${issue.error.message}-${String(index)}`} error={issue.error} onRetry={issue.retry} />)}
    {feedback.mutationError === null || feedback.mutationError === undefined ? null : <ErrorAlert error={feedback.mutationError} />}
    <OperationRecoveryNotice
      notice={feedback.recoveryNotice} pending={status.recoveryPending}
      onReplay={actions.replayRecovery} onDismiss={actions.dismissRecovery}
    />
    {feedback.unconfirmedMessage === undefined
      ? null
      : <p className="status-note warning" role="status">{feedback.unconfirmedMessage}{" "}<Link href="/proformas">Registrul de proforme</Link></p>}
    {feedback.issuerWarning === undefined
      ? null
      : <p className="status-note warning" role="status">{feedback.issuerWarning} Proforma nu este document fiscal; salvarea rămâne disponibilă.</p>}
    <form className="authoring-layout" onSubmit={(event) => { event.preventDefault(); actions.save() }}>
      <div className="section-stack">
        <ProformaAuthoringHeader session={session} />
        <section className="card authoring-section">
          <label className="notes-field">Observații <span className="optional">opțional</span>
            <Textarea disabled={status.pending} maxLength={feedback.notesMaxLength} rows={3}
              aria-describedby="proforma-notes-status" aria-invalid={feedback.notesIssue !== null}
              value={document.form.notes} onChange={(event) => { actions.changeForm({ notes: event.currentTarget.value }) }} />
          </label>
          <p className={feedback.notesIssue === null ? "hint" : "hint warning"} id="proforma-notes-status" aria-live="polite">
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
      <div className="authoring-side"><ProformaAuthoringActions session={session} /></div>
    </form>
  </>
}
