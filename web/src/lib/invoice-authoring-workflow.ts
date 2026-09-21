import type { DraftInvoice } from "./models.ts"

export type DraftDeletionState =
  | { readonly kind: "hidden" }
  | { readonly kind: "available" }
  | { readonly kind: "derived"; readonly sourceHref: string }

export const draftDeletionState = (draft: DraftInvoice | undefined): DraftDeletionState => {
  if (draft === undefined) return { kind: "hidden" }
  if (draft.sourceProformaId === null) return { kind: "available" }
  return {
    kind: "derived",
    sourceHref: `/proformas/${encodeURIComponent(draft.sourceProformaId)}`,
  }
}

export const invoiceDueDateIssue = (required: boolean): string | null => required
  ? "Data scadenței este obligatorie pentru o factură cu total pozitiv."
  : null

export const authoringBackgroundErrors = (
  errors: ReadonlyArray<Error>,
  additional: Error | null,
): ReadonlyArray<Error> => additional === null ? errors : [...errors, additional]
