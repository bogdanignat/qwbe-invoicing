import type { DraftInvoice, Issuer } from "./draft-models.ts"

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

export const authoringBackgroundErrors = (
  errors: ReadonlyArray<Error>,
  additional: Error | null,
): ReadonlyArray<Error> => additional === null ? errors : [...errors, additional]

/** Mirrors the server's issuance warnings, so the editor can say what would fail before it does. */
export const issuerIssuanceWarning = (
  issuer: Pick<Issuer, "legalForm" | "tradeRegistryNumber" | "socialCapital">,
): string | undefined => {
  if (issuer.tradeRegistryNumber === "") return "Completează numărul de la Registrul Comerțului în setările firmei din aplicația existentă înainte de emitere."
  if (issuer.legalForm === "srl" && issuer.socialCapital === "") return "Completează capitalul social în setările firmei din aplicația existentă înainte de emiterea pentru SRL."
  return undefined
}
