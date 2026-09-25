import {
  newEditableDocumentLine, preferredUnitOfMeasure,
  type BuyerMode, type DocumentAuthoringForm, type EditableDocumentLine, type PartyType,
} from "./document-authoring-form-model.ts"

/**
 * The invoice's view of the shared authoring model.
 *
 * The form and the editable line are the document-neutral ones: an invoice
 * screen and a proforma screen edit the same fields, so the names here are
 * aliases, not second declarations. What stays invoice-specific is what only
 * an invoice draft has — the save operations against a stored draft, and the
 * access rules of a draft that is already locked.
 */
export type InvoiceAuthoringForm = DocumentAuthoringForm
export type EditableInvoiceLine = EditableDocumentLine
export const newEditableInvoiceLine = newEditableDocumentLine

export type { BuyerMode, PartyType }
export { preferredUnitOfMeasure }

export type LineSaveOperation =
  | { readonly kind: "create"; readonly line: EditableInvoiceLine }
  | { readonly kind: "update"; readonly line: EditableInvoiceLine; readonly lineId: string }

export interface AuthoringReadiness {
  readonly editable: boolean
  readonly synchronized: boolean
  readonly hasLines: boolean
  readonly canIssue: boolean
}

export interface AuthoringTaxReadiness {
  readonly canIssue: boolean
  readonly synchronized: boolean
  readonly warning: string | null
}

/**
 * A locked document points at the registry it actually belongs to: a draft
 * already issued as a proforma is found under the proformas, not among the
 * invoices. The union stays closed so no screen can invent a route.
 */
export type AuthoringRegistryHref = "/invoices" | "/proformas"

export type AuthoringAccess =
  | { readonly editable: true }
  | {
    readonly editable: false
    readonly notice: string
    readonly registryHref: AuthoringRegistryHref
    readonly registryLabel: string
  }
