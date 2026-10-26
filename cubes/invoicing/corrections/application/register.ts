import { Effect } from "effect"

import {
  checked, cursorInteger, cursorText, invalidCursor, pageOf, pageQuery, type Authorize, type OperationDependencies,
  type Page, type PageRequest,
} from "../../application/support.ts"
import { ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSource } from "../../domain/invoice.ts"
import { validateDocumentSource } from "../../domain/validation.ts"
import {
  normalizeRegisterFilter, registerFilterIssues,
  type InvoiceRegisterCursor, type InvoiceRegisterFilter, type InvoiceRegisterKind, type InvoiceRegisterRow,
} from "../domain/register.ts"
import type { CorrectionWork } from "./ports.ts"

const everything: InvoiceRegisterFilter = {}

const registerKind = (value: unknown): InvoiceRegisterKind => {
  if (value !== "invoice" && value !== "correction") throw invalidCursor()
  return value
}

export const createInvoiceRegisterOperations = (
  dependencies: OperationDependencies<CorrectionWork>, permissions: InvoicingPermissions, authorize: Authorize,
) => {
  const listInvoiceRegister = (
    source?: DocumentSource, page?: PageRequest, filter: InvoiceRegisterFilter = everything,
  ): Effect.Effect<Page<InvoiceRegisterRow>, InvoicingFailure> => Effect.gen(function*() {
    if (source !== undefined) yield* checked(() => { validateDocumentSource(source) })
    const issues = registerFilterIssues(filter)
    if (issues.length > 0) return yield* Effect.fail(new ValidationFailure({ issues }))
    const query = yield* checked(() => pageQuery<InvoiceRegisterCursor>(page, (raw) => ({
      issueDate: cursorText(raw.issueDate), number: cursorInteger(raw.number), id: cursorText(raw.id), kind: registerKind(raw.kind),
    })))
    const context = yield* authorize(permissions.read)
    const rows = yield* dependencies.store.transaction((transaction) =>
      transaction.listInvoiceRegister(context.organization.id, query, source, normalizeRegisterFilter(filter)))
    return pageOf(rows, query, (item) => ({ issueDate: item.issueDate, number: item.number, id: item.id, kind: item.kind }))
  })
  return { listInvoiceRegister }
}
export type InvoiceRegisterOperations = ReturnType<typeof createInvoiceRegisterOperations>
