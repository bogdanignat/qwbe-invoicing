import type { DraftInvoice } from "./draft-models.ts"
import type {
  AuthoringAccess, AuthoringReadiness, AuthoringTaxReadiness,
  EditableInvoiceLine, InvoiceAuthoringForm, LineSaveOperation,
} from "./invoice-authoring-model.ts"
import { documentLinesReady, documentTaxReadiness } from "./document-authoring-readiness.ts"
import { selectedTaxIdentifier } from "./document-authoring-transitions.ts"
import { lineInputMatches } from "./document-authoring-options.ts"

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
  return sameBuyer
    && draft.series === form.series
    && draft.issueDate === form.issueDate
    && (draft.dueDate ?? "") === form.dueDate
    && (draft.notes ?? "") === form.notes.trim()
}

export const pendingLineOperations = (
  lines: ReadonlyArray<EditableInvoiceLine>,
  draft: DraftInvoice,
  forcedUpdateLineIds: ReadonlyArray<string> = [],
): ReadonlyArray<LineSaveOperation> => lines.flatMap((line): ReadonlyArray<LineSaveOperation> => {
  if (line.lineId === undefined) return [{ kind: "create", line }]
  const persisted = draft.lines.find((item) => item.id === line.lineId)
  return persisted !== undefined
    && lineInputMatches(line, persisted)
    && !forcedUpdateLineIds.includes(line.lineId)
    ? []
    : [{ kind: "update", line, lineId: line.lineId }]
})

export const linesMatchDraft = (
  lines: ReadonlyArray<EditableInvoiceLine>,
  draft: DraftInvoice,
): boolean => lines.length === draft.lines.length && pendingLineOperations(lines, draft).length === 0

export const authoringTaxReadiness = (
  readiness: AuthoringReadiness,
  staleTax: boolean,
): AuthoringTaxReadiness => documentTaxReadiness(readiness, staleTax)

export const authoringReadiness = (
  form: InvoiceAuthoringForm,
  lines: ReadonlyArray<EditableInvoiceLine>,
  draft: DraftInvoice | undefined,
  pending: boolean,
): AuthoringReadiness => {
  const editable = draft === undefined || draft.status === "draft"
  const synchronized = editable
    && draft !== undefined
    && headerMatchesDraft(form, draft)
    && linesMatchDraft(lines, draft)
  const hasLines = documentLinesReady(lines)
  return {
    editable,
    synchronized,
    hasLines,
    canIssue: editable && hasLines && !pending && (draft === undefined || synchronized),
  }
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
