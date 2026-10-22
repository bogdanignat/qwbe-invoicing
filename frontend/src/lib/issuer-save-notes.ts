import { issuerSaveWarning, type IssuerWarning } from "./issuer-save-result.ts"
import { ISSUER_SAVED, ISSUER_SAVED_WHILE_EDITING } from "./settings-revisions.ts"
import { UnreadableAnswer } from "./unreadable-answer.ts"

/**
 * The two sentences the issuer card shows after a save: the notice that it was
 * saved, and the warning that ANAF did not check it.
 *
 * Both belong to one answer, so they appear and vanish together: a new save, a
 * dismissal or a failure clears them, and only an answer sets them, the notice
 * worded by whether the form was replaced (`savedFormReplacesEdits`). A failure
 * never stands next to a notice of the save before it.
 */
export interface IssuerSaveNotes {
  readonly notice: string | undefined
  readonly warning: string | undefined
}

export type IssuerSaveEvent =
  | { readonly kind: "sent" | "dismissed" | "failed" }
  | { readonly kind: "saved"; readonly replacesEdits: boolean; readonly warnings: ReadonlyArray<IssuerWarning> }

export const NO_SAVE_NOTES: IssuerSaveNotes = { notice: undefined, warning: undefined }

export const issuerSaveNotes = (event: IssuerSaveEvent): IssuerSaveNotes => event.kind === "saved"
  ? { notice: event.replacesEdits ? ISSUER_SAVED : ISSUER_SAVED_WHILE_EDITING, warning: issuerSaveWarning(event.warnings) }
  : NO_SAVE_NOTES

export const ISSUER_SAVE_UNREADABLE =
  "Răspunsul serverului nu a putut fi citit. Datele firmei au fost reîncărcate; verifică-le și salvează din nou dacă e nevoie."

/**
 * The save's failure as the issuer card shows it. `UnreadableAnswer` speaks of
 * documents and the register; here the profile may be saved and is read again,
 * so it says that instead. Every other failure keeps its own message.
 */
export const issuerSaveError = (error: unknown): unknown =>
  error instanceof UnreadableAnswer ? new Error(ISSUER_SAVE_UNREADABLE, { cause: error }) : error
