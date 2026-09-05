import { Effect } from "effect"

import { checked, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import { calculateLine } from "../../domain/calculation.ts"
import type { DocumentSource, DraftInvoice } from "../../domain/invoice.ts"
import type { CreateDraftInput, UpdateDraftInput } from "../../domain/inputs.ts"
import { resolveVatConfiguration, validateDocumentSource } from "../../domain/validation.ts"
import { authorDocument, buyerFrom, dates, documentSource, findEditable, withTotals } from "./authoring.ts"

export interface DraftDocumentOperations {
  readonly createDraft: (input: CreateDraftInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly getDraft: (id: string) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly listDrafts: (source?: DocumentSource) => Effect.Effect<ReadonlyArray<DraftInvoice>, InvoicingFailure>
  readonly updateDraft: (input: UpdateDraftInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly deleteDraft: (id: string) => Effect.Effect<void, InvoicingFailure>
}

export const createDraftDocumentOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): DraftDocumentOperations => {
  const createDraft = (input: CreateDraftInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    const id = yield* dependencies.ids.next
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const { document } = yield* authorDocument(input, context.organization.id, transaction, dependencies.ids)
      const draft: DraftInvoice = { id, ...document, status: "draft" }
      yield* transaction.saveDraft(draft)
      return structuredClone(draft)
    }))
  })
  const getDraft = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const draft = yield* dependencies.store.transaction((transaction) => transaction.findDraft(context.organization.id, id))
    return draft === undefined ? yield* Effect.fail(missing("draft", id)) : structuredClone(draft)
  })
  const listDrafts = (source?: DocumentSource) => Effect.gen(function*() {
    if (source !== undefined) yield* checked(() => { validateDocumentSource(source) })
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listDrafts(context.organization.id, source)))
  })
  const updateDraft = (input: UpdateDraftInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const current = yield* findEditable(transaction, context.organization.id, input.draftId)
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      const buyer = yield* buyerFrom(input, context.organization.id, transaction)
      const header = yield* dates(input.issueDate, input.dueDate)
      const source = input.source === undefined ? current.source : yield* documentSource(input.source ?? undefined)
      const lines = yield* Effect.forEach(current.lines, (line) => checked(() => calculateLine({
        id: line.id, description: line.description, quantity: line.quantity, unitPrice: line.unitPrice,
        unitOfMeasure: line.unitOfMeasure,
        vat: resolveVatConfiguration(issuer, line.vatRateCode, input.issueDate),
      })))
      const base = { ...current }
      delete base.customerId
      delete base.source
      const updated = withTotals({ ...base, ...buyer, ...(source === undefined ? {} : { source }), ...header, lines })
      yield* transaction.saveDraft(updated)
      return structuredClone(updated)
    }))
  })
  const deleteDraft = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      yield* findEditable(transaction, context.organization.id, id)
      yield* transaction.deleteDraft(context.organization.id, id)
    }))
  })
  return { createDraft, getDraft, listDrafts, updateDraft, deleteDraft }
}
