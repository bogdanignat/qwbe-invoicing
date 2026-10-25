import type { DraftInvoice, Issuer } from "./draft-models.ts"
import type { AuthoringReadiness } from "./invoice-authoring-model.ts"

/**
 * What a derived draft says instead of a delete button: which proforma owns it
 * and where that proforma can be opened. The link is derived from the draft's
 * own `sourceProformaId`, so the notice names a document rather than another
 * application.
 */
export interface DerivedDraftNotice {
  readonly message: string
  readonly proformaHref: string
  readonly proformaLabel: string
}

export const derivedDraftNotice = (sourceProformaId: string): DerivedDraftNotice => ({
  message: "Draft creat dintr-o proformă emisă. Nu poate fi șters — proforma sursă îl controlează; poate fi editat, salvat și emis normal.",
  proformaHref: `/proformas/${encodeURIComponent(sourceProformaId)}`,
  proformaLabel: "Deschide proforma sursă",
})

/**
 * A draft created from a proforma cannot be deleted — the proforma owns it —
 * but it stays editable and issuable as an invoice.
 */
export type DraftDeletionState =
  | { readonly kind: "hidden" }
  | { readonly kind: "available" }
  | { readonly kind: "derived"; readonly notice: DerivedDraftNotice }
  /** Already sealed as a fiscal document: the delete button has no business being offered. */
  | { readonly kind: "issued" }

export const draftDeletionState = (draft: DraftInvoice | undefined): DraftDeletionState => {
  if (draft === undefined) return { kind: "hidden" }
  if (draft.status !== "draft") return { kind: "issued" }
  const source = draft.sourceProformaId
  if (source === null) return { kind: "available" }
  return { kind: "derived", notice: derivedDraftNotice(source) }
}

export const invoiceDueDateIssue = (required: boolean): string | null => required
  ? "Data scadenței este obligatorie pentru o factură cu total pozitiv."
  : null

export const UNSAVED_CHANGES_ISSUE = "Draftul are modificări nesalvate. Salvează draftul înainte de emitere."
export const INCOMPLETE_LINES_ISSUE = "Completează toate liniile (descriere, cantitate, preț, unitate, cotă TVA) și corectează codurile semnalate înainte de emitere."

export interface IssueBlockInput {
  readonly readiness: Pick<AuthoringReadiness, "editable" | "synchronized" | "hasLines">
  readonly hasDraft: boolean
  /** Whether anything was typed on a line (`documentLinesStarted`); a blank new document is not told off. */
  readonly linesStarted: boolean
  /** A write in flight or unresolved speaks for itself (button label, recovery notice). */
  readonly pending: boolean
  readonly staleTaxWarning: string | null
  readonly dueDateIssue: string | null
  readonly seriesWarning: string | undefined
}

/** Why "Emite factura" is closed, in the words the screen already uses for each rule, so the button never just goes grey. */
export const issueBlockReasons = (input: IssueBlockInput): ReadonlyArray<string> => {
  if (input.pending || !input.readiness.editable) return []
  return [
    input.readiness.hasLines || !(input.hasDraft || input.linesStarted) ? null : INCOMPLETE_LINES_ISSUE,
    input.hasDraft && !input.readiness.synchronized ? UNSAVED_CHANGES_ISSUE : null,
    input.staleTaxWarning,
    input.dueDateIssue,
    input.seriesWarning ?? null,
  ].filter((reason) => reason !== null)
}

export const authoringBackgroundErrors = (
  errors: ReadonlyArray<Error>,
  additional: Error | null,
): ReadonlyArray<Error> => additional === null ? errors : [...errors, additional]

/** Mirrors the server's issuance warnings, so the editor can say what would fail before it does. */
export const issuerIssuanceWarning = (
  issuer: Pick<Issuer, "legalForm" | "tradeRegistryNumber" | "socialCapital">,
): string | undefined => {
  if (issuer.tradeRegistryNumber === "") return "Completează numărul de la Registrul Comerțului în Setări, la datele firmei, înainte de emitere."
  if (issuer.legalForm === "srl" && issuer.socialCapital === "") return "Completează capitalul social în Setări, la datele firmei, înainte de emiterea pentru SRL."
  return undefined
}
