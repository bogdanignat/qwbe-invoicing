import type { AuthoringDocumentInput, CreateDraftInput, DraftLineInput, UpdateDraftInput } from "./invoicing-client.ts"
import {
  invoiceDocumentSeries, proformaDocumentSeries,
  type BuyerSnapshot, type Customer, type DocumentSeries, type DraftInvoice, type Issuer, type PartyType, type ProductPreset, type UnitOfMeasure,
} from "./models.ts"
import { countyRequiresSector } from "./romanian-counties.ts"
import { normalizeRomanianCui } from "./vat-defaults.ts"

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

export const preferredUnitOfMeasure = (units: ReadonlyArray<UnitOfMeasure>): UnitOfMeasure =>
  units.find(({ code }) => code === "C62") ?? units[0] ?? { code: "C62", name: "unitate" }

export const newEditableInvoiceLine = (
  key: string, vatRateCode: string, unitOfMeasure: UnitOfMeasure,
): EditableInvoiceLine => ({ key, description: "", quantity: "1", unitPrice: "", unitOfMeasure, vatRateCode })

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
  name: "", companyTaxIdentifier: "", individualTaxIdentifier: "", vatRegistered: false,
  countryCode: "RO", city: "", street: "", county: "", sector: undefined, postalCode: "",
  series, issueDate, dueDate: addCalendarDays(issueDate, issuer.defaultPaymentTermDays), dueDateEdited: false,
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

export const selectBuyerCounty = (form: InvoiceAuthoringForm, county: string): InvoiceAuthoringForm => ({
  ...form,
  county,
  sector: countyRequiresSector(county) ? form.sector : undefined,
})

export const editBuyerFiscalIdentifier = (form: InvoiceAuthoringForm, value: string): InvoiceAuthoringForm => form.partyType === "company"
  ? { ...form, companyTaxIdentifier: normalizeRomanianCui(value) }
  : { ...form, individualTaxIdentifier: value.replace(/\D/g, "") }

export const selectBuyerSector = (form: InvoiceAuthoringForm, sector: string): InvoiceAuthoringForm => ({
  ...form,
  sector: Number(sector),
})

const buyerPayload = (form: InvoiceAuthoringForm): { readonly customerId: string } | { readonly customer: BuyerSnapshot } =>
  form.buyerMode === "saved"
    ? { customerId: form.customerId }
    : {
        customer: {
          partyType: form.partyType,
          name: form.name,
          fiscalIdentifier: form.partyType === "company" ? normalizeRomanianCui(selectedTaxIdentifier(form)) : selectedTaxIdentifier(form),
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

export const documentNotesMaxLength = 300

/** Mirrors the server-side remark rules so the textarea can explain an invisible paste before submitting. */
export const documentNotesIssue = (notes: string): string | null => {
  if (/(?!\n)[\p{Cc}\p{Zl}\p{Zp}]/u.test(notes)) return "Observatiile nu pot contine caractere de control; inlocuieste tab-urile cu spatii."
  return notes.trim().length > documentNotesMaxLength ? `Observatiile depasesc ${String(documentNotesMaxLength)} de caractere.` : null
}

const decimal = (value: string): number | undefined => {
  const trimmed = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

const nonNegativeScaled = (value: string, scale: number): bigint | undefined => {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (match === null || (match[2]?.length ?? 0) > scale) return undefined
  return BigInt(match[1] ?? "0") * 10n ** BigInt(scale) + BigInt((match[2] ?? "").padEnd(scale, "0"))
}

export const positiveInvoiceRequiresDueDate = (
  dueDate: string | null,
  totalIncludingVat: string | undefined,
  lines: ReadonlyArray<Pick<EditableInvoiceLine, "quantity" | "unitPrice">> = [],
): boolean => {
  if (dueDate !== null && dueDate !== "") return false
  const total = totalIncludingVat === undefined ? undefined : decimal(totalIncludingVat)
  if (total !== undefined) return total > 0
  return lines.some((line) => {
    const quantity = nonNegativeScaled(line.quantity, 4)
    const unitPrice = nonNegativeScaled(line.unitPrice, 2)
    // Domain rounds each nonnegative line net to cents, half-up. Nonnegative VAT
    // cannot turn a zero base positive; any rounded positive base makes the total positive.
    return quantity !== undefined && unitPrice !== undefined && (quantity * unitPrice + 5_000n) / 10_000n > 0n
  })
}

export const createDraftPayload = (form: InvoiceAuthoringForm): CreateDraftInput => ({
  ...buyerPayload(form), series: form.series, issueDate: form.issueDate, currency: "RON",
  dueDate: form.dueDate === "" ? null : form.dueDate,
  notes: form.notes.trim() === "" ? null : form.notes.trim(),
})

export const updateDraftPayload = (form: InvoiceAuthoringForm): UpdateDraftInput => ({
  ...buyerPayload(form), issueDate: form.issueDate,
  dueDate: form.dueDate === "" ? null : form.dueDate,
  notes: form.notes.trim() === "" ? null : form.notes.trim(),
})

export const draftLinePayload = (line: EditableInvoiceLine): DraftLineInput => ({
  description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
  unitOfMeasure: line.unitOfMeasure, vatRateCode: line.vatRateCode,
})

export const authoringDocumentPayload = (
  form: InvoiceAuthoringForm,
  lines: ReadonlyArray<EditableInvoiceLine>,
): AuthoringDocumentInput => ({ ...createDraftPayload(form), currency: "RON", lines: lines.map(draftLinePayload) })

const sameBuyerSnapshot = (left: BuyerSnapshot, right: BuyerSnapshot): boolean =>
  (["partyType", "name", "fiscalIdentifier", "vatRegistered"] as const).every((key) => left[key] === right[key])
  && (["countryCode", "city", "street", "county", "sector", "postalCode"] as const).every((key) => left.address[key] === right.address[key])

export const authoringPayloadMatchesDraft = (payload: AuthoringDocumentInput, draft: DraftInvoice): boolean => {
  const sameBuyer = "customerId" in payload
    ? draft.customerId === payload.customerId
    : draft.customerId === undefined && sameBuyerSnapshot(draft.customer, payload.customer)
  return sameBuyer && draft.series === payload.series && draft.issueDate === payload.issueDate
    && draft.dueDate === (payload.dueDate ?? null) && draft.currency === payload.currency
    && draft.notes === (payload.notes ?? null)
    && draft.lines.length === payload.lines.length && draft.lines.every((line, index) => {
      const expected = payload.lines[index]
      return expected !== undefined && line.description === expected.description && line.quantity === expected.quantity
        && line.unitPrice === expected.unitPrice && line.unitOfMeasure.code === expected.unitOfMeasure.code
        && line.unitOfMeasure.name === expected.unitOfMeasure.name && line.vatRateCode === expected.vatRateCode
    })
}

export const switchBuyerMode = (form: InvoiceAuthoringForm, buyerMode: BuyerMode): InvoiceAuthoringForm => ({
  ...form,
  buyerMode,
})

export const switchPartyType = (form: InvoiceAuthoringForm, partyType: PartyType): InvoiceAuthoringForm => ({
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

export const draftLinesForEditing = (draft: DraftInvoice): ReadonlyArray<EditableInvoiceLine> => draft.lines.map((line) => ({
  key: line.id, lineId: line.id, description: line.description, quantity: line.quantity,
  unitPrice: line.unitPrice, unitOfMeasure: line.unitOfMeasure, vatRateCode: line.vatRateCode,
}))

export const headerMatchesDraft = (form: InvoiceAuthoringForm, draft: DraftInvoice): boolean => {
  const sameBuyer = form.buyerMode === "saved"
    ? draft.customerId === form.customerId
    : draft.customerId === undefined
      && draft.customer.partyType === form.partyType
      && draft.customer.name === form.name
      && draft.customer.fiscalIdentifier === selectedTaxIdentifier(form)
      && draft.customer.vatRegistered === (form.partyType === "company" && form.vatRegistered)
      && draft.customer.address.countryCode === form.countryCode
      && draft.customer.address.city === form.city
      && draft.customer.address.street === form.street
      && draft.customer.address.county === form.county
      && draft.customer.address.sector === form.sector
      && (draft.customer.address.postalCode ?? "") === form.postalCode
  return sameBuyer && draft.series === form.series && draft.issueDate === form.issueDate
    && (draft.dueDate ?? "") === form.dueDate && (draft.notes ?? "") === form.notes.trim()
}

const lineMatches = (line: EditableInvoiceLine, persisted: DraftInvoice["lines"][number]): boolean =>
  line.description === persisted.description && line.quantity === persisted.quantity
  && line.unitPrice === persisted.unitPrice && line.unitOfMeasure.code === persisted.unitOfMeasure.code
  && line.unitOfMeasure.name === persisted.unitOfMeasure.name && line.vatRateCode === persisted.vatRateCode

export const pendingLineOperations = (
  lines: ReadonlyArray<EditableInvoiceLine>, draft: DraftInvoice, forcedUpdateLineIds: ReadonlyArray<string> = [],
): ReadonlyArray<LineSaveOperation> =>
  lines.flatMap((line): ReadonlyArray<LineSaveOperation> => {
    if (line.lineId === undefined) return [{ kind: "create", line }]
    const persisted = draft.lines.find((item) => item.id === line.lineId)
    return persisted !== undefined && lineMatches(line, persisted) && !forcedUpdateLineIds.includes(line.lineId)
      ? []
      : [{ kind: "update", line, lineId: line.lineId }]
  })

export const linesMatchDraft = (lines: ReadonlyArray<EditableInvoiceLine>, draft: DraftInvoice): boolean =>
  lines.length === draft.lines.length && pendingLineOperations(lines, draft).length === 0

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

export const authoringTaxReadiness = (
  readiness: AuthoringReadiness, staleTax: boolean,
): AuthoringTaxReadiness => ({
  canIssue: readiness.canIssue && !staleTax,
  synchronized: readiness.synchronized && !staleTax,
  warning: staleTax
    ? "Configurația TVA s-a schimbat. Actualizează și salvează configurația TVA a liniilor afectate înainte de emitere."
    : null,
})

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
    && line.unitOfMeasure.code.trim() !== "" && line.unitOfMeasure.name.trim() !== "" && line.vatRateCode.trim() !== "")
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
