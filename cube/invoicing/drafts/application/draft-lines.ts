import { Effect } from "effect"

import { checked, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import { calculateLine } from "../../domain/calculation.ts"
import type { AddDraftLineInput, DraftInvoice, UpdateDraftLineInput } from "../../domain/invoice.ts"
import { resolveVatConfiguration } from "../../domain/validation.ts"
import { findEditable, withTotals } from "./authoring.ts"

export interface DraftLineOperations {
  readonly addDraftLine: (input: AddDraftLineInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly updateDraftLine: (input: UpdateDraftLineInput) => Effect.Effect<DraftInvoice, InvoicingFailure>
  readonly deleteDraftLine: (draftId: string, lineId: string) => Effect.Effect<DraftInvoice, InvoicingFailure>
}

export const createDraftLineOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): DraftLineOperations => {
  const mutateLine = (input: AddDraftLineInput, lineId: string, replace: boolean) => Effect.gen(function*() {
    const context = yield* authorize(permissions.draftInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const draft = yield* findEditable(transaction, context.organization.id, input.draftId)
      const index = draft.lines.findIndex((line) => line.id === lineId)
      if (replace && index < 0) return yield* Effect.fail(missing("draft_line", lineId))
      const issuer = yield* transaction.findIssuer(context.organization.id)
      if (issuer === undefined) return yield* Effect.fail(missing("issuer", context.organization.id))
      const vat = yield* checked(() => resolveVatConfiguration(issuer, input.vatRateCode, draft.issueDate))
      const line = yield* checked(() => calculateLine({ ...input, id: lineId, vat }))
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
      const draft = yield* findEditable(transaction, context.organization.id, draftId)
      if (!draft.lines.some((line) => line.id === lineId)) return yield* Effect.fail(missing("draft_line", lineId))
      const updated = withTotals({ ...draft, lines: draft.lines.filter((line) => line.id !== lineId) })
      yield* transaction.saveDraft(updated)
      return structuredClone(updated)
    }))
  })
  return { addDraftLine, updateDraftLine, deleteDraftLine }
}
