import type { Customer, DraftInvoice, Issuer, UnitOfMeasure, VatCatalogue } from "./draft-models.ts"
import type { EditableInvoiceLine, InvoiceAuthoringForm } from "./invoice-authoring-model.ts"
import { newEditableInvoiceLine, preferredUnitOfMeasure } from "./invoice-authoring-model.ts"
import { draftLinesForEditing } from "./document-authoring-options.ts"
import { formFromDraft, newAuthoringForm, proposeMissingDueDate } from "./document-authoring-transitions.ts"
import { defaultVatCode } from "./vat-defaults.ts"

/**
 * What the authoring screen opens with: a blank document dated today, or the
 * saved draft as it is — except that an open draft saved without a due date
 * gets the one a new document would (see `proposeMissingDueDate`), from the
 * payment term of its saved buyer as read for it (`draftBuyer`).
 */
export interface AuthoringOpeningInput {
  readonly initialDraft: DraftInvoice | undefined
  /** The draft's saved buyer, read by id; absent when not needed or not readable (the issuer's term applies). */
  readonly draftBuyer: Customer | undefined
  readonly issuer: Issuer
  readonly vatCatalogue: VatCatalogue
  readonly customers: ReadonlyArray<Customer>
  readonly invoiceSeries: ReadonlyArray<string>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
}

export const openingAuthoringForm = (input: AuthoringOpeningInput, today: string): InvoiceAuthoringForm =>
  input.initialDraft === undefined
    ? newAuthoringForm(input.issuer, input.invoiceSeries[0] ?? "", input.customers.length > 0, today)
    : proposeMissingDueDate(formFromDraft(input.initialDraft), input.initialDraft, input.draftBuyer, input.issuer)

/** The saved buyer whose payment term the opening proposal needs: only for an open draft without a due date. */
export const draftBuyerToRead = (draft: DraftInvoice | undefined): string | undefined =>
  draft?.status === "draft" && draft.dueDate === null ? draft.customerId : undefined

export const openingAuthoringLines = (
  input: AuthoringOpeningInput,
  today: string,
  key: string,
): ReadonlyArray<EditableInvoiceLine> => input.initialDraft === undefined
  ? [newEditableInvoiceLine(
      key,
      defaultVatCode(input.vatCatalogue, input.issuer, today),
      preferredUnitOfMeasure(input.unitOfMeasures),
    )]
  : draftLinesForEditing(input.initialDraft)
