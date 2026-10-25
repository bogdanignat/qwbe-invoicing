import { AppLink } from "../ui/AppLink.tsx"
import type { InvoiceAuthoringSession } from "../../hooks/invoice-authoring-session-types.ts"
import { Button } from "../Button.tsx"
import { ISSUE_BLOCK_REASONS_ID, IssueBlockReasons } from "./IssueBlockReasons.tsx"

/**
 * Save, issue and delete, with every warning the session computed. Issuance is
 * confirmed before it leaves (the number and the fiscal document become
 * immutable), and the due-date note explains that a draft may be saved without
 * one while a positive-total invoice may not.
 */
export const AuthoringActions = ({ session }: { readonly session: InvoiceAuthoringSession }) => {
  const { actions, feedback, status, draftDeletion } = session
  return <section className="card authoring-section">
    <h2>Acțiuni document</h2>
    <Button className="secondary full-width" type="submit" disabled={status.pending || status.recoveryBlocked}>
      {status.savePending ? "Se salvează toate modificările…" : "Salvează draftul"}
    </Button>
    <p className="hint">Draftul este opțional și rămâne editabil.</p>
    <h2>Emitere factură</h2>
    <Button className="full-width" disabled={!status.canIssueInvoice} onClick={(event) => {
      if (event.currentTarget.form?.reportValidity() !== false) actions.issueInvoice()
    }} aria-describedby={feedback.issueBlockReasons.length === 0 ? undefined : ISSUE_BLOCK_REASONS_ID}>
      {status.invoicePending ? "Se emite…" : "Emite factura"}
    </Button>
    <IssueBlockReasons reasons={feedback.issueBlockReasons} />
    {draftDeletion.kind === "hidden" ? null : draftDeletion.kind === "available"
      ? <Button className="danger full-width" disabled={status.pending} onClick={actions.deleteDraft}>Șterge draftul</Button>
      : draftDeletion.kind === "derived"
        ? <p className="status-note">
          {draftDeletion.notice.message}{" "}
          <AppLink href={draftDeletion.notice.proformaHref}>{draftDeletion.notice.proformaLabel}</AppLink>
        </p>
        : null}
    <p className="hint">Dintr-un document nou poți emite direct. Dacă ai salvat deja draftul, salvează întâi orice modificare nouă.</p>
    {feedback.notice === null ? null : <p className="status-note" role="status" aria-live="polite">{feedback.notice}</p>}
  </section>
}
