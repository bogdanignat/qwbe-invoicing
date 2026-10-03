import type { EditableDocumentLine } from "./document-authoring-form-model.ts"

/**
 * What any document needs before it can be issued, independent of what issuing
 * it means.
 *
 * A proforma is issued in one call and an invoice may go through a stored
 * draft, but neither may leave with an empty line, and both are blocked the
 * same way when the VAT configuration under them changed after the lines were
 * written. Those two rules live here; everything about drafts stays with the
 * draft.
 */
export interface DocumentTaxReadiness {
  readonly canIssue: boolean
  readonly synchronized: boolean
  readonly warning: string | null
}

export const STALE_TAX_WARNING = "Configurația TVA s-a schimbat. Actualizează și salvează configurația TVA a liniilor afectate înainte de emitere."

/** Every line filled in: a blank description, quantity, price, unit or VAT code is not a line yet. */
export const documentLinesReady = (lines: ReadonlyArray<EditableDocumentLine>): boolean =>
  lines.length > 0 && lines.every((line) =>
    line.description.trim() !== ""
    && line.quantity.trim() !== ""
    && line.unitPrice.trim() !== ""
    && line.unitOfMeasure.code.trim() !== ""
    && line.unitOfMeasure.name.trim() !== ""
    && line.vatRateCode.trim() !== "")

/** A stale tax configuration withdraws the right to issue and says why, whatever the rest of the screen thinks. */
export const documentTaxReadiness = (
  readiness: { readonly canIssue: boolean; readonly synchronized: boolean },
  staleTax: boolean,
): DocumentTaxReadiness => ({
  canIssue: readiness.canIssue && !staleTax,
  synchronized: readiness.synchronized && !staleTax,
  warning: staleTax ? STALE_TAX_WARNING : null,
})
