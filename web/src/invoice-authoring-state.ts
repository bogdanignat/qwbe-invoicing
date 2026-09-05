import type { AuthoringDocumentInput, CreateDraftInput, DraftLineInput, UpdateDraftInput } from "./invoicing-client.ts"
import {
  invoiceDocumentSeries, proformaDocumentSeries,
  type BuyerSnapshot, type Customer, type DocumentSeries, type DraftInvoice, type Issuer, type PartyType, type ProductPreset,
} from "./models.ts"

export type BuyerMode = "saved" | "one-time"

export const initialBuyerSelection = (hasSavedCustomers: boolean): { readonly buyerMode: BuyerMode; readonly customerId: string } => ({
  buyerMode: hasSavedCustomers ? "saved" : "one-time",
  customerId: "",
})

export const authoringSeriesOptions = (series: ReadonlyArray<DocumentSeries>): {
  readonly invoice: ReadonlyArray<string>
  readonly proforma: ReadonlyArray<string>
} => ({
  invoice: invoiceDocumentSeries(series).map((item) => item.series),
  proforma: proformaDocumentSeries(series).map((item) => item.series),
})

export interface InvoiceAuthoringForm {
  readonly buyerMode: BuyerMode
  readonly customerId: string
  readonly partyType: PartyType
  readonly legalName: string
  readonly companyTaxIdentifier: string
  readonly individualTaxIdentifier: string
  readonly countryCode: "RO"
  readonly city: string
  readonly street: string
  readonly county: string
  readonly postalCode: string
  readonly series: string
  readonly issueDate: string
  readonly dueDate: string
  readonly dueDateEdited: boolean
}

export interface EditableInvoiceLine extends DraftLineInput {
  readonly key: string
  readonly lineId?: string
}

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
  ...initialBuyerSelection(hasSavedCustomers), partyType: "company",
  legalName: "", companyTaxIdentifier: "", individualTaxIdentifier: "", countryCode: "RO", city: "", street: "", county: "", postalCode: "",
  series, issueDate, dueDate: addCalendarDays(issueDate, issuer.defaultPaymentTermDays), dueDateEdited: false,
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

export const editDueDate = (form: InvoiceAuthoringForm, dueDate: string): InvoiceAuthoringForm => ({
  ...form,
  dueDate,
  dueDateEdited: true,
})

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
    dueDate: addCalendarDays(next.issueDate, paymentTermFor(selectedSavedCustomer(next, customers), issuer)),
    dueDateEdited: false,
  }
}

export const applyProductPreset = (line: EditableInvoiceLine, preset: ProductPreset): EditableInvoiceLine => ({
  ...line,
  description: preset.description,
  quantity: "1",
  unitPrice: preset.unitPrice,
  unitOfMeasure: preset.unitOfMeasure,
})

export type LineSaveOperation =
  | { readonly kind: "create"; readonly line: EditableInvoiceLine }
  | { readonly kind: "update"; readonly line: EditableInvoiceLine; readonly lineId: string }

export const selectedTaxIdentifier = (form: InvoiceAuthoringForm): string =>
  form.partyType === "company" ? form.companyTaxIdentifier : form.individualTaxIdentifier

const buyerPayload = (form: InvoiceAuthoringForm): { readonly customerId: string } | { readonly customer: BuyerSnapshot } =>
  form.buyerMode === "saved"
    ? { customerId: form.customerId }
    : {
        customer: {
          partyType: form.partyType,
          legalName: form.legalName,
          taxIdentifier: selectedTaxIdentifier(form),
          address: {
            countryCode: form.countryCode,
            city: form.city,
            street: form.street,
            ...(form.county === "" ? {} : { county: form.county }),
            ...(form.postalCode === "" ? {} : { postalCode: form.postalCode }),
          },
        },
      }

export const createDraftPayload = (form: InvoiceAuthoringForm): CreateDraftInput => ({
  ...buyerPayload(form), series: form.series, issueDate: form.issueDate, currency: "RON",
  dueDate: form.dueDate === "" ? null : form.dueDate,
})

export const updateDraftPayload = (form: InvoiceAuthoringForm): UpdateDraftInput => ({
  ...buyerPayload(form), issueDate: form.issueDate,
  dueDate: form.dueDate === "" ? null : form.dueDate,
})

export const draftLinePayload = (line: EditableInvoiceLine): DraftLineInput => ({
  description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
  unitOfMeasure: line.unitOfMeasure, taxCode: line.taxCode,
})

export const authoringDocumentPayload = (
  form: InvoiceAuthoringForm,
  lines: ReadonlyArray<EditableInvoiceLine>,
): AuthoringDocumentInput => ({ ...createDraftPayload(form), currency: "RON", lines: lines.map(draftLinePayload) })

export const authoringPayloadMatchesDraft = (payload: AuthoringDocumentInput, draft: DraftInvoice): boolean => {
  const sameBuyer = "customerId" in payload
    ? draft.customerId === payload.customerId
    : draft.customerId === undefined && JSON.stringify(draft.customer) === JSON.stringify(payload.customer)
  return sameBuyer && draft.series === payload.series && draft.issueDate === payload.issueDate
    && draft.dueDate === (payload.dueDate ?? null) && draft.currency === payload.currency
    && draft.lines.length === payload.lines.length && draft.lines.every((line, index) => {
      const expected = payload.lines[index]
      return expected !== undefined && line.description === expected.description && line.quantity === expected.quantity
        && line.unitPrice === expected.unitPrice && line.unitOfMeasure.code === expected.unitOfMeasure.code
        && line.unitOfMeasure.name === expected.unitOfMeasure.name && line.taxCode === expected.taxCode
    })
}

export const switchBuyerMode = (form: InvoiceAuthoringForm, buyerMode: BuyerMode): InvoiceAuthoringForm => ({
  ...form,
  buyerMode,
})

export const switchPartyType = (form: InvoiceAuthoringForm, partyType: PartyType): InvoiceAuthoringForm => ({
  ...form,
  partyType,
})

export const formFromDraft = (draft: DraftInvoice): InvoiceAuthoringForm => ({
  buyerMode: draft.customerId === undefined ? "one-time" : "saved",
  customerId: draft.customerId ?? "",
  partyType: draft.customer.partyType,
  legalName: draft.customer.legalName,
  companyTaxIdentifier: draft.customer.partyType === "company" ? draft.customer.taxIdentifier : "",
  individualTaxIdentifier: draft.customer.partyType === "individual" ? draft.customer.taxIdentifier : "",
  countryCode: "RO",
  city: draft.customer.address.city,
  street: draft.customer.address.street,
  county: draft.customer.address.county ?? "",
  postalCode: draft.customer.address.postalCode ?? "",
  series: draft.series,
  issueDate: draft.issueDate,
  dueDate: draft.dueDate ?? "",
  dueDateEdited: true,
})

export const draftLinesForEditing = (draft: DraftInvoice): ReadonlyArray<EditableInvoiceLine> => draft.lines.map((line) => ({
  key: line.id, lineId: line.id, description: line.description, quantity: line.quantity,
  unitPrice: line.unitPrice, unitOfMeasure: line.unitOfMeasure, taxCode: line.taxCode,
}))

export const headerMatchesDraft = (form: InvoiceAuthoringForm, draft: DraftInvoice): boolean => {
  const sameBuyer = form.buyerMode === "saved"
    ? draft.customerId === form.customerId
    : draft.customerId === undefined
      && draft.customer.partyType === form.partyType
      && draft.customer.legalName === form.legalName
      && draft.customer.taxIdentifier === selectedTaxIdentifier(form)
      && draft.customer.address.countryCode === form.countryCode
      && draft.customer.address.city === form.city
      && draft.customer.address.street === form.street
      && (draft.customer.address.county ?? "") === form.county
      && (draft.customer.address.postalCode ?? "") === form.postalCode
  return sameBuyer && draft.series === form.series && draft.issueDate === form.issueDate && (draft.dueDate ?? "") === form.dueDate
}

const lineMatches = (line: EditableInvoiceLine, persisted: DraftInvoice["lines"][number]): boolean =>
  line.description === persisted.description && line.quantity === persisted.quantity
  && line.unitPrice === persisted.unitPrice && line.unitOfMeasure.code === persisted.unitOfMeasure.code
  && line.unitOfMeasure.name === persisted.unitOfMeasure.name && line.taxCode === persisted.taxCode

export const pendingLineOperations = (lines: ReadonlyArray<EditableInvoiceLine>, draft: DraftInvoice): ReadonlyArray<LineSaveOperation> =>
  lines.flatMap((line): ReadonlyArray<LineSaveOperation> => {
    if (line.lineId === undefined) return [{ kind: "create", line }]
    const persisted = draft.lines.find((item) => item.id === line.lineId)
    return persisted !== undefined && lineMatches(line, persisted) ? [] : [{ kind: "update", line, lineId: line.lineId }]
  })

export const linesMatchDraft = (lines: ReadonlyArray<EditableInvoiceLine>, draft: DraftInvoice): boolean =>
  lines.length === draft.lines.length && pendingLineOperations(lines, draft).length === 0

export interface AuthoringReadiness {
  readonly editable: boolean
  readonly synchronized: boolean
  readonly hasLines: boolean
  readonly canIssue: boolean
}

export const authoringReadiness = (
  form: InvoiceAuthoringForm,
  lines: ReadonlyArray<EditableInvoiceLine>,
  draft: DraftInvoice | undefined,
  pending: boolean,
): AuthoringReadiness => {
  const editable = draft === undefined || draft.status === "draft"
  const synchronized = editable && draft !== undefined && headerMatchesDraft(form, draft) && linesMatchDraft(lines, draft)
  const hasLines = lines.length > 0 && lines.every((line) =>
    line.description.trim() !== "" && line.quantity.trim() !== "" && line.unitPrice.trim() !== ""
    && line.unitOfMeasure.code.trim() !== "" && line.unitOfMeasure.name.trim() !== "" && line.taxCode.trim() !== "")
  return { editable, synchronized, hasLines,
    canIssue: editable && hasLines && !pending && (draft === undefined || synchronized) }
}

export type AuthoringAccess =
  | { readonly editable: true }
  | {
      readonly editable: false
      readonly notice: string
      readonly registryHref: "/invoices" | "/proformas"
      readonly registryLabel: string
    }

export const authoringAccess = (status: DraftInvoice["status"]): AuthoringAccess => {
  if (status === "issued") return {
    editable: false,
    notice: "Acest draft a fost deja emis ca factură și este blocat. Nu mai poate fi modificat, șters sau emis din nou.",
    registryHref: "/invoices",
    registryLabel: "Deschide registrul de facturi",
  }
  if (status === "proforma_issued") return {
    editable: false,
    notice: "Acest draft a fost deja emis ca proformă și este blocat. Nu mai poate fi modificat, șters sau emis din nou.",
    registryHref: "/proformas",
    registryLabel: "Deschide registrul de proforme",
  }
  return { editable: true }
}

export const identifierLabel = (partyType: PartyType): string => partyType === "company" ? "CUI / CIF" : "CNP"
