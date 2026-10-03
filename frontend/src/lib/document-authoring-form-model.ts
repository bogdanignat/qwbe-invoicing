import type { DraftLineInput, UnitOfMeasure } from "./draft-models.ts"
import type { BuyerSnapshot } from "./document-snapshot.ts"

/**
 * The shape an authoring screen edits, for any document that has a buyer, a
 * series, dates and lines.
 *
 * An invoice and a proforma are authored from exactly the same fields — the
 * difference is what the server is asked to do with them — so the form model
 * is stated once here and the document-specific modules build on it instead of
 * each declaring their own copy that would drift.
 */
export interface DocumentAuthoringForm {
  readonly buyerMode: BuyerMode
  readonly customerId: string
  readonly partyType: PartyType
  readonly name: string
  readonly companyTaxIdentifier: string
  readonly individualTaxIdentifier: string
  readonly vatRegistered: boolean
  readonly countryCode: "RO"
  readonly city: string
  readonly street: string
  readonly county: string
  readonly sector: number | undefined
  readonly postalCode: string
  readonly series: string
  readonly issueDate: string
  readonly dueDate: string
  readonly dueDateEdited: boolean
  readonly notes: string
}

export type PartyType = BuyerSnapshot["partyType"]
export type BuyerMode = "saved" | "one-time"

/** A line being edited. `lineId` is present only once the server holds it. */
export interface EditableDocumentLine extends DraftLineInput {
  readonly key: string
  readonly lineId?: string
}

export const preferredUnitOfMeasure = (units: ReadonlyArray<UnitOfMeasure>): UnitOfMeasure =>
  units.find(({ code }) => code === "C62") ?? units[0] ?? { code: "C62", name: "unitate" }

export const newEditableDocumentLine = (
  key: string,
  vatRateCode: string,
  unitOfMeasure: UnitOfMeasure,
): EditableDocumentLine => ({
  key, description: "", quantity: "1", unitPrice: "", unitOfMeasure, vatRateCode,
})
