import type {
  AuthoringDocumentInput, CreateDraftInput, DraftLineInput, UpdateDraftInput,
} from "./invoicing-client-types.ts"
import type { BuyerSnapshot, DraftInvoice } from "./models.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"
import type { EditableInvoiceLine, InvoiceAuthoringForm } from "./invoice-authoring-model.ts"
import { selectedTaxIdentifier } from "./invoice-authoring-transitions.ts"

const buyerPayload = (
  form: InvoiceAuthoringForm,
): { readonly customerId: string } | { readonly customer: BuyerSnapshot } =>
  form.buyerMode === "saved"
    ? { customerId: form.customerId }
    : {
        customer: {
          partyType: form.partyType,
          name: form.name,
          fiscalIdentifier: form.partyType === "company"
            ? normalizeRomanianCui(selectedTaxIdentifier(form))
            : selectedTaxIdentifier(form),
          vatRegistered: form.partyType === "company" && form.vatRegistered,
          address: {
            countryCode: form.countryCode,
            city: form.city,
            street: form.street,
            county: form.county,
            ...(form.sector === undefined ? {} : { sector: form.sector }),
            ...(form.postalCode === "" ? {} : { postalCode: form.postalCode }),
          },
        },
      }

export const createDraftPayload = (form: InvoiceAuthoringForm): CreateDraftInput => ({
  ...buyerPayload(form),
  series: form.series,
  issueDate: form.issueDate,
  currency: "RON",
  dueDate: form.dueDate === "" ? null : form.dueDate,
  notes: form.notes.trim() === "" ? null : form.notes.trim(),
})

export const updateDraftPayload = (form: InvoiceAuthoringForm): UpdateDraftInput => ({
  ...buyerPayload(form),
  issueDate: form.issueDate,
  dueDate: form.dueDate === "" ? null : form.dueDate,
  notes: form.notes.trim() === "" ? null : form.notes.trim(),
})

export const draftLinePayload = (line: EditableInvoiceLine): DraftLineInput => ({
  description: line.description,
  quantity: line.quantity,
  unitPrice: line.unitPrice,
  unitOfMeasure: line.unitOfMeasure,
  vatRateCode: line.vatRateCode,
})

export const authoringDocumentPayload = (
  form: InvoiceAuthoringForm,
  lines: ReadonlyArray<EditableInvoiceLine>,
): AuthoringDocumentInput => ({
  ...createDraftPayload(form),
  currency: "RON",
  lines: lines.map(draftLinePayload),
})

const sameBuyerSnapshot = (left: BuyerSnapshot, right: BuyerSnapshot): boolean =>
  (["partyType", "name", "fiscalIdentifier", "vatRegistered"] as const)
    .every((key) => left[key] === right[key])
  && (["countryCode", "city", "street", "county", "sector", "postalCode"] as const)
    .every((key) => left.address[key] === right.address[key])

export const authoringPayloadMatchesDraft = (
  payload: AuthoringDocumentInput,
  draft: DraftInvoice,
): boolean => {
  const sameBuyer = "customerId" in payload
    ? draft.customerId === payload.customerId
    : draft.customerId === undefined && sameBuyerSnapshot(draft.customer, payload.customer)
  return sameBuyer
    && draft.series === payload.series
    && draft.issueDate === payload.issueDate
    && draft.dueDate === (payload.dueDate ?? null)
    && draft.currency === payload.currency
    && draft.notes === (payload.notes ?? null)
    && draft.lines.length === payload.lines.length
    && draft.lines.every((line, index) => {
      const expected = payload.lines[index]
      return expected !== undefined
        && line.description === expected.description
        && line.quantity === expected.quantity
        && line.unitPrice === expected.unitPrice
        && line.unitOfMeasure.code === expected.unitOfMeasure.code
        && line.unitOfMeasure.name === expected.unitOfMeasure.name
        && line.vatRateCode === expected.vatRateCode
    })
}
