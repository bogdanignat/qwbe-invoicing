/**
 * How an authoring form changes, one named transition at a time.
 *
 * Every function here takes a form and returns the next form: no state, no
 * screen, no document family. An invoice and a proforma share every one of
 * these moves — choosing a buyer, deriving the due date from the payment term,
 * switching the party type — so they live in one place and each authoring
 * session applies them to its own state.
 */
import type { BuyerSnapshot, UnitOfMeasure } from "./document-snapshot.ts"
import type { Customer, DraftInvoice, Issuer } from "./draft-models.ts"
import { addCalendarDays } from "./calendar-days.ts"
import { countyRequiresSector } from "./romanian-counties.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"
import type { BuyerMode, DocumentAuthoringForm, PartyType } from "./document-authoring-form-model.ts"

export const initialBuyerSelection = (
  hasSavedCustomers: boolean,
): { readonly buyerMode: BuyerMode; readonly customerId: string } => ({
  buyerMode: hasSavedCustomers ? "saved" : "one-time",
  customerId: "",
})

const paymentTermFor = (customer: Customer | undefined, issuer: Issuer): number =>
  customer?.defaultPaymentTermDays ?? issuer.defaultPaymentTermDays

export const selectedSavedCustomer = (
  form: DocumentAuthoringForm,
  customers: ReadonlyArray<Customer>,
): Customer | undefined => form.buyerMode === "saved"
  ? customers.find((customer) => customer.id === form.customerId)
  : undefined

export const newAuthoringForm = (
  issuer: Issuer,
  series: string,
  hasSavedCustomers: boolean,
  issueDate: string,
): DocumentAuthoringForm => ({
  ...initialBuyerSelection(hasSavedCustomers),
  partyType: "company",
  name: "",
  companyTaxIdentifier: "",
  individualTaxIdentifier: "",
  vatRegistered: false,
  countryCode: "RO",
  city: "",
  street: "",
  county: "",
  sector: undefined,
  postalCode: "",
  series,
  issueDate,
  dueDate: addCalendarDays(issueDate, issuer.defaultPaymentTermDays),
  dueDateEdited: false,
  notes: "",
})

export const selectSavedCustomer = (
  form: DocumentAuthoringForm,
  customerId: string,
  customer: Customer | undefined,
  issuer: Issuer,
  deriveDueDate: boolean,
): DocumentAuthoringForm => ({
  ...form,
  customerId,
  ...(deriveDueDate && customer !== undefined
    ? { dueDate: addCalendarDays(form.issueDate, paymentTermFor(customer, issuer)), dueDateEdited: false }
    : {}),
})

export const selectIssueDate = (
  form: DocumentAuthoringForm,
  issueDate: string,
  customer: Customer | undefined,
  issuer: Issuer,
  deriveDueDate: boolean,
): DocumentAuthoringForm => ({
  ...form,
  issueDate,
  ...(deriveDueDate && !form.dueDateEdited
    ? { dueDate: addCalendarDays(issueDate, paymentTermFor(customer, issuer)), dueDateEdited: false }
    : {}),
})

export const editDueDate = (
  form: DocumentAuthoringForm,
  dueDate: string,
): DocumentAuthoringForm => ({ ...form, dueDate, dueDateEdited: true })

export const selectBuyerMode = (
  form: DocumentAuthoringForm,
  buyerMode: BuyerMode,
  customers: ReadonlyArray<Customer>,
  issuer: Issuer,
  deriveDueDate: boolean,
): DocumentAuthoringForm => {
  const next = { ...form, buyerMode }
  if (!deriveDueDate || form.dueDateEdited) return next
  return {
    ...next,
    dueDate: addCalendarDays(
      next.issueDate,
      paymentTermFor(selectedSavedCustomer(next, customers), issuer),
    ),
    dueDateEdited: false,
  }
}

export const selectedTaxIdentifier = (form: DocumentAuthoringForm): string =>
  form.partyType === "company" ? form.companyTaxIdentifier : form.individualTaxIdentifier

export const selectBuyerCounty = (
  form: DocumentAuthoringForm,
  county: string,
): DocumentAuthoringForm => ({
  ...form,
  county,
  sector: countyRequiresSector(county) ? form.sector : undefined,
})

export const editBuyerFiscalIdentifier = (
  form: DocumentAuthoringForm,
  value: string,
): DocumentAuthoringForm => form.partyType === "company"
  ? { ...form, companyTaxIdentifier: normalizeRomanianCui(value) }
  : { ...form, individualTaxIdentifier: value.replace(/\D/g, "") }

export const selectBuyerSector = (
  form: DocumentAuthoringForm,
  sector: string,
): DocumentAuthoringForm => ({ ...form, sector: Number(sector) })

export const switchBuyerMode = (
  form: DocumentAuthoringForm,
  buyerMode: BuyerMode,
): DocumentAuthoringForm => ({ ...form, buyerMode })

export const switchPartyType = (
  form: DocumentAuthoringForm,
  partyType: PartyType,
): DocumentAuthoringForm => ({
  ...form,
  partyType,
  vatRegistered: partyType === "individual" ? false : form.vatRegistered,
})

export const formFromDraft = (draft: DraftInvoice): DocumentAuthoringForm => ({
  buyerMode: draft.customerId === undefined ? "one-time" : "saved",
  customerId: draft.customerId ?? "",
  partyType: draft.customer.partyType,
  name: draft.customer.name,
  companyTaxIdentifier: draft.customer.partyType === "company" ? draft.customer.fiscalIdentifier : "",
  individualTaxIdentifier: draft.customer.partyType === "individual" ? draft.customer.fiscalIdentifier : "",
  vatRegistered: draft.customer.vatRegistered,
  countryCode: "RO",
  city: draft.customer.address.city,
  street: draft.customer.address.street,
  county: draft.customer.address.county,
  sector: draft.customer.address.sector,
  postalCode: draft.customer.address.postalCode ?? "",
  series: draft.series,
  issueDate: draft.issueDate,
  dueDate: draft.dueDate ?? "",
  dueDateEdited: true,
  notes: draft.notes ?? "",
})

export const identifierLabel = (partyType: PartyType): string =>
  partyType === "company" ? "CUI / CIF" : "CNP"

export type { BuyerSnapshot, UnitOfMeasure }
