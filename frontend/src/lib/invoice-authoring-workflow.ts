import type { DraftInvoice, Issuer } from "./draft-models.ts"

/**
 * A draft created from a proforma cannot be deleted — the proforma owns it —
 * but it stays editable and issuable as an invoice. The legacy client linked
 * back to the proforma; this frontend has no proforma screens, so the state
 * names the situation and points only at the invoice registry.
 */
export type DraftDeletionState =
  | { readonly kind: "hidden" }
  | { readonly kind: "available" }
  | { readonly kind: "derived" }

export const draftDeletionState = (draft: DraftInvoice | undefined): DraftDeletionState => {
  if (draft === undefined) return { kind: "hidden" }
  if (draft.sourceProformaId === null) return { kind: "available" }
  return { kind: "derived" }
}

export const derivedDraftNotice =
  "Draft creat dintr-o proformă emisă în aplicația existentă. Nu poate fi șters; poate fi editat, salvat și emis normal."

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
