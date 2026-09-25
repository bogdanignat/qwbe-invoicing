import { documentLinesReady } from "./document-authoring-readiness.ts"
import { documentNotesIssue } from "./invoice-notes-validation.ts"
import type { EditableInvoiceLine, InvoiceAuthoringForm } from "./invoice-authoring-model.ts"
import { positiveInvoiceRequiresDueDate } from "./invoice-positive-total.ts"

/**
 * Whether the one write this screen makes may leave, as a plain function.
 *
 * A proforma is authored whole: there is no draft to compare against and no
 * issuance step, so readiness is exactly the document itself — a chosen series,
 * filled lines, notes within the limit — plus whatever the screen already
 * refuses for.
 */
export interface ProformaSaveReadinessInput {
  readonly form: InvoiceAuthoringForm
  readonly lines: ReadonlyArray<EditableInvoiceLine>
  readonly seriesOptions: ReadonlyArray<string>
  readonly pending: boolean
  /** An unresolved journal entry or a result already known: nothing new may be authored. */
  readonly blocked: boolean
}

export interface ProformaSaveReadiness {
  readonly canSave: boolean
  readonly notesIssue: string | null
  /**
   * A proforma with a positive total and no due date is legal, but it can only
   * ever become a *draft* invoice later — the conversion to an issued invoice
   * needs the term. Said here, while the date can still be typed, rather than
   * discovered on the document screen.
   */
  readonly dueDateNote: string | null
  readonly seriesMissing: boolean
}

export const PROFORMA_DUE_DATE_NOTE = "Fără scadență, proforma va putea fi transformată doar în draft de factură, nu direct în factură emisă."

export const proformaSaveReadiness = (input: ProformaSaveReadinessInput): ProformaSaveReadiness => {
  const notesIssue = documentNotesIssue(input.form.notes)
  const seriesChosen = input.form.series !== "" && input.seriesOptions.includes(input.form.series)
  return {
    notesIssue,
    seriesMissing: input.seriesOptions.length === 0,
    canSave: seriesChosen
      && documentLinesReady(input.lines)
      && notesIssue === null
      && !input.pending
      && !input.blocked,
    dueDateNote: positiveInvoiceRequiresDueDate(
      input.form.dueDate === "" ? null : input.form.dueDate,
      undefined,
      input.lines,
    )
      ? PROFORMA_DUE_DATE_NOTE
      : null,
  }
}
