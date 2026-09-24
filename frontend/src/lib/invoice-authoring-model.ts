import type { DraftLineInput, UnitOfMeasure } from "./draft-models.ts"
import type { BuyerSnapshot } from "./document-snapshot.ts"

export type PartyType = BuyerSnapshot["partyType"]
export type BuyerMode = "saved" | "one-time"

export interface InvoiceAuthoringForm {
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

export interface EditableInvoiceLine extends DraftLineInput {
  readonly key: string
  readonly lineId?: string
}

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

/** This frontend has no proforma screens: the only registry it can point at is `/invoices`. */
export type AuthoringAccess =
  | { readonly editable: true }
  | {
    readonly editable: false
    readonly notice: string
    readonly registryHref: "/invoices"
    readonly registryLabel: string
  }

export const preferredUnitOfMeasure = (units: ReadonlyArray<UnitOfMeasure>): UnitOfMeasure =>
  units.find(({ code }) => code === "C62") ?? units[0] ?? { code: "C62", name: "unitate" }

export const newEditableInvoiceLine = (
  key: string,
  vatRateCode: string,
  unitOfMeasure: UnitOfMeasure,
): EditableInvoiceLine => ({
  key, description: "", quantity: "1", unitPrice: "", unitOfMeasure, vatRateCode,
})
