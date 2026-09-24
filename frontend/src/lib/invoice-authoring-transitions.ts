import type { BuyerSnapshot, UnitOfMeasure } from "./document-snapshot.ts"
import type { Customer, DraftInvoice, Issuer } from "./draft-models.ts"
import { countyRequiresSector } from "./romanian-counties.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"
import type { BuyerMode, InvoiceAuthoringForm, PartyType } from "./invoice-authoring-model.ts"

export const initialBuyerSelection = (
  hasSavedCustomers: boolean,
): { readonly buyerMode: BuyerMode; readonly customerId: string } => ({
  buyerMode: hasSavedCustomers ? "saved" : "one-time",
  customerId: "",
})

export const addCalendarDays = (date: string, days: number): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(days) || days < 0) return ""
  const value = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== date) return ""
  value.setUTCDate(value.getUTCDate() + days)
  if (Number.isNaN(value.getTime())) return ""
  const shifted = value.toISOString()
  return /^\d{4}-\d{2}-\d{2}T/.test(shifted) ? shifted.slice(0, 10) : ""
}

const paymentTermFor = (customer: Customer | undefined, issuer: Issuer): number =>
  customer?.defaultPaymentTermDays ?? issuer.defaultPaymentTermDays

export const selectedSavedCustomer = (
  form: InvoiceAuthoringForm,
  customers: ReadonlyArray<Customer>,
): Customer | undefined => form.buyerMode === "saved"
  ? customers.find((customer) => customer.id === form.customerId)
  : undefined

export const newAuthoringForm = (
  issuer: Issuer,
  series: string,
  hasSavedCustomers: boolean,
  issueDate: string,
): InvoiceAuthoringForm => ({
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
  form: InvoiceAuthoringForm,
  customerId: string,
  customer: Customer | undefined,
  issuer: Issuer,
  deriveDueDate: boolean,
): InvoiceAuthoringForm => ({
  ...form,
  customerId,
  ...(deriveDueDate && customer !== undefined
    ? { dueDate: addCalendarDays(form.issueDate, paymentTermFor(customer, issuer)), dueDateEdited: false }
    : {}),
})

export const selectIssueDate = (
  form: InvoiceAuthoringForm,
  issueDate: string,
  customer: Customer | undefined,
  issuer: Issuer,
  deriveDueDate: boolean,
): InvoiceAuthoringForm => ({
  ...form,
  issueDate,
  ...(deriveDueDate && !form.dueDateEdited
    ? { dueDate: addCalendarDays(issueDate, paymentTermFor(customer, issuer)), dueDateEdited: false }
    : {}),
})

export const editDueDate = (
  form: InvoiceAuthoringForm,
  dueDate: string,
): InvoiceAuthoringForm => ({ ...form, dueDate, dueDateEdited: true })

export const selectBuyerMode = (
  form: InvoiceAuthoringForm,
  buyerMode: BuyerMode,
  customers: ReadonlyArray<Customer>,
  issuer: Issuer,
  deriveDueDate: boolean,
): InvoiceAuthoringForm => {
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

export const selectedTaxIdentifier = (form: InvoiceAuthoringForm): string =>
  form.partyType === "company" ? form.companyTaxIdentifier : form.individualTaxIdentifier

export const selectBuyerCounty = (
  form: InvoiceAuthoringForm,
  county: string,
): InvoiceAuthoringForm => ({
  ...form,
  county,
  sector: countyRequiresSector(county) ? form.sector : undefined,
})

export const editBuyerFiscalIdentifier = (
  form: InvoiceAuthoringForm,
  value: string,
): InvoiceAuthoringForm => form.partyType === "company"
  ? { ...form, companyTaxIdentifier: normalizeRomanianCui(value) }
  : { ...form, individualTaxIdentifier: value.replace(/\D/g, "") }

export const selectBuyerSector = (
  form: InvoiceAuthoringForm,
  sector: string,
): InvoiceAuthoringForm => ({ ...form, sector: Number(sector) })

export const switchBuyerMode = (
  form: InvoiceAuthoringForm,
  buyerMode: BuyerMode,
): InvoiceAuthoringForm => ({ ...form, buyerMode })

export const switchPartyType = (
  form: InvoiceAuthoringForm,
  partyType: PartyType,
): InvoiceAuthoringForm => ({
  ...form,
  partyType,
  vatRegistered: partyType === "individual" ? false : form.vatRegistered,
})

export const formFromDraft = (draft: DraftInvoice): InvoiceAuthoringForm => ({
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
