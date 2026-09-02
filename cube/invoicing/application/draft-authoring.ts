import { Effect } from "effect"

import { DomainConflict, ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type { IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { calculateLine, calculateTotals } from "../domain/calculation.ts"
import {
  addDays,
  type AddDraftLineInput,
  type BuyerSnapshot,
  type CreateDraftInput,
  type DraftInvoice,
  type IssuerProfile,
  type UpdateDraftInput,
  type UpdateDraftLineInput,
} from "../domain/invoice.ts"
import { resolveTaxConfiguration, validateBuyer, validateDate, validateDocumentSeries } from "../domain/validation.ts"
import type { InvoicingTransaction } from "./ports.ts"
import { checked, copyBuyer, missing } from "./support.ts"

export interface DraftAuthoringOperations {
  readonly createDraft: (input: CreateDraftInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly getDraft: (id: string) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly listDrafts: () => Effect.Effect<ReadonlyArray<DraftInvoice>, InvoicingFailure>
  readonly updateDraft: (input: UpdateDraftInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly deleteDraft: (id: string) => Effect.Effect<void, InvoicingFailure>
  readonly addDraftLine: (input: AddDraftLineInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly updateDraftLine: (input: UpdateDraftLineInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly deleteDraftLine: (draftId: string, lineId: string) => Effect.Effect<DraftInvoice, InvoicingFailure>
}

type Dependencies = { ids: IdGenerator; store: TransactionalStore<InvoicingTransaction> }
type Authorize = (permission: string) => Effect.Effect<RequestContext, InvoicingFailure>

const withTotals = (draft: Omit<DraftInvoice, "taxBreakdown" | "totalExcludingTax" | "taxTotal" | "totalIncludingTax">): DraftInvoice => ({
  ...draft,
  ...calculateTotals(draft.lines),
})

const editable = (draft: DraftInvoice): Effect.Effect<DraftInvoice, DomainConflict> => draft.status === "draft"
  ? Effect.succeed(draft)
  : Effect.fail(new DomainConflict({ code: "invoice_already_issued", message: "Issued invoices cannot be edited" }))

const buyerFrom = (
  input: CreateDraftInput | UpdateDraftInput,
  organizationId: string,
  transaction: InvoicingTransaction,
): Effect.Effect<{ readonly customer: BuyerSnapshot; readonly customerId?: string }, InvoicingFailure> => Effect.gen(function*() {
  const customerId = "customerId" in input && typeof input.customerId === "string" ? input.customerId : undefined
  const inline = "customer" in input ? input.customer : undefined
  yield* checked(() => {
    if ((customerId === undefined) === (inline === undefined)) {
      throw new ValidationFailure({ issues: ["exactly one of customerId or customer is required"] })
    }
    if (customerId !== undefined && customerId.trim() === "") {
      throw new ValidationFailure({ issues: ["customerId is required"] })
    }
  })
  if (customerId !== undefined) {
    const customer = yield* transaction.findCustomer(organizationId, customerId)
    if (customer === undefined || customer.deletedAt !== undefined) return yield* Effect.fail(missing("customer", customerId))
    return { customer: copyBuyer(customer), customerId: customer.id }
  }
  const customer = copyBuyer(inline as BuyerSnapshot)
  yield* checked(() => { validateBuyer(customer) })
  return { customer }
})

const dates = (issueDate: string, dueDate: string | undefined, issuer: IssuerProfile) => checked(() => {
  validateDate(issueDate, "issueDate")
  const due = dueDate ?? addDays(issueDate, issuer.defaultPaymentTermDays)
  validateDate(due, "dueDate")
  if (due < issueDate) throw new ValidationFailure({ issues: ["dueDate cannot be before issueDate"] })
  return { issueDate, dueDate: due }
})

export const createDraftAuthoringOperations = (
  dependencies: Dependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): DraftAuthoringOperations => {
  const createDraft = (input: CreateDraftInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    const id = yield* dependencies.ids.next
    yield* checked(() => {
      validateDocumentSeries({ organizationId: context.organization.id, documentType: "invoice", series: input.series })
      if (input.currency !== undefined && input.currency !== "RON") throw new ValidationFailure({ issues: ["currency must be RON"] })
    })
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      const documentSeries = yield* transaction.findDocumentSeries(context.organization.id, "invoice", input.series)
      if (documentSeries === undefined) return yield* Effect.fail(missing("document_series", input.series))
      const buyer = yield* buyerFrom(input, context.organization.id, transaction)
      const header = yield* dates(input.issueDate, input.dueDate, issuer)
      const draft = withTotals({ id, organizationId: context.organization.id, ...buyer, series: documentSeries.series, ...header, currency: "RON", status: "draft", lines: [] })
      yield* transaction.saveDraft(draft)
      return structuredClone(draft)
    }))
  })
  const getDraft = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const draft = yield* dependencies.store.transaction((transaction) => transaction.findDraft(context.organization.id, id))
    return draft === undefined ? yield* Effect.fail(missing("draft", id)) : structuredClone(draft)
  })
  const listDrafts = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listDrafts(context.organization.id)))
  })
  const updateDraft = (input: UpdateDraftInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const current = yield* transaction.findDraft(context.organization.id, input.draftId)
      if (current === undefined) return yield* Effect.fail(missing("draft", input.draftId))
      yield* editable(current)
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      const buyer = yield* buyerFrom(input, context.organization.id, transaction)
      const header = yield* dates(input.issueDate, input.dueDate, issuer)
      const lines = yield* Effect.forEach(current.lines, (line) => checked(() => calculateLine({
        id: line.id, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
        tax: resolveTaxConfiguration(issuer, line.taxCode, input.issueDate),
      })))
      const base = { ...current }
      delete base.customerId
      const updated = withTotals({ ...base, ...buyer, ...header, lines })
      yield* transaction.saveDraft(updated)
      return structuredClone(updated)
    }))
  })
  const deleteDraft = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const draft = yield* transaction.findDraft(context.organization.id, id)
      if (draft === undefined) return yield* Effect.fail(missing("draft", id))
      yield* editable(draft)
      yield* transaction.deleteDraft(context.organization.id, id)
    }))
  })
  const mutateLine = (input: AddDraftLineInput, lineId: string, replace: boolean) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const draft = yield* transaction.findDraft(context.organization.id, input.draftId)
      if (draft === undefined) return yield* Effect.fail(missing("draft", input.draftId))
      yield* editable(draft)
      const index = draft.lines.findIndex((line) => line.id === lineId)
      if (replace && index < 0) return yield* Effect.fail(missing("draft_line", lineId))
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      const tax = yield* checked(() => resolveTaxConfiguration(issuer, input.taxCode, draft.issueDate))
      const line = yield* checked(() => calculateLine({ ...input, id: lineId, tax }))
      const lines = replace ? draft.lines.map((value) => value.id === lineId ? line : value) : [...draft.lines, line]
      const updated = withTotals({ ...draft, lines })
      yield* transaction.saveDraft(updated)
      return structuredClone(updated)
    }))
  })
  const addDraftLine = (input: AddDraftLineInput) => Effect.flatMap(dependencies.ids.next, (id) => mutateLine(input, id, false))
  const updateDraftLine = (input: UpdateDraftLineInput) => mutateLine(input, input.lineId, true)
  const deleteDraftLine = (draftId: string, lineId: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const draft = yield* transaction.findDraft(context.organization.id, draftId)
      if (draft === undefined) return yield* Effect.fail(missing("draft", draftId))
      yield* editable(draft)
      if (!draft.lines.some((line) => line.id === lineId)) return yield* Effect.fail(missing("draft_line", lineId))
      const updated = withTotals({ ...draft, lines: draft.lines.filter((line) => line.id !== lineId) })
      yield* transaction.saveDraft(updated)
      return structuredClone(updated)
    }))
  })
  return { createDraft, getDraft, listDrafts, updateDraft, deleteDraft, addDraftLine, updateDraftLine, deleteDraftLine }
}
