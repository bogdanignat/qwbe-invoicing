"use client"

import Link from "next/link"

import type { InvoiceAuthoringSession } from "../../hooks/invoice-authoring-session-types.ts"
import { Button } from "../Button.tsx"

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
    }}>
      {status.invoicePending ? "Se emite…" : "Emite factura"}
    </Button>
    {draftDeletion.kind === "hidden" ? null : draftDeletion.kind === "available"
      ? <Button className="danger full-width" disabled={status.pending} onClick={actions.deleteDraft}>Șterge draftul</Button>
      : draftDeletion.kind === "derived"
        ? <p className="status-note">
          {draftDeletion.notice.message}{" "}
          <Link href={draftDeletion.notice.proformaHref}>{draftDeletion.notice.proformaLabel}</Link>
        </p>
        : null}
    <p className="hint">Dintr-un document nou poți emite direct. Dacă ai salvat deja draftul, salvează întâi orice modificare nouă.</p>
    {feedback.notice === null ? null : <p className="status-note" role="status" aria-live="polite">{feedback.notice}</p>}
  </section>
}
