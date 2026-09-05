import { Effect } from "effect"

import { findIdempotencyReplay, idempotencyRecord, missingIdempotencyResult } from "../../application/idempotency.ts"
import { checked, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSource, Idempotent, IssuedInvoice } from "../../domain/invoice.ts"
import type { AuthoringDocumentInput } from "../../domain/inputs.ts"
import { validateDocumentSource } from "../../domain/validation.ts"
import { fiscalYear, issuanceSource, numberedSnapshot } from "./snapshot.ts"

export type IssueInvoiceInput = Idempotent<AuthoringDocumentInput | { readonly draftId: string }>

export interface InvoiceOperations {
  readonly issueInvoice: (input: IssueInvoiceInput) => Effect.Effect<IssuedInvoice, InvoicingFailure>
  readonly getIssuedInvoice: (id: string) => Effect.Effect<IssuedInvoice, InvoicingFailure>
  readonly listIssuedInvoices: (source?: DocumentSource) => Effect.Effect<ReadonlyArray<IssuedInvoice>, InvoicingFailure>
}

export const createInvoiceOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): InvoiceOperations => {
  const issueInvoice = ({ request: input, idempotency }: IssueInvoiceInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.issueInvoices)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const operation = "draftId" in input ? "issue_invoice_from_draft" : "issue_invoice_direct"
      const replayId = yield* findIdempotencyReplay(transaction, context.organization.id, idempotency, operation, "invoice")
      if (replayId !== undefined) {
        const replay = yield* transaction.findIssuedInvoice(context.organization.id, replayId)
        return replay === undefined ? yield* Effect.fail(missingIdempotencyResult("invoice")) : structuredClone(replay)
      }
      const { document, issuer, draft } = yield* issuanceSource(input, context.organization.id, transaction, dependencies.ids, "invoice")
      const invoiceId = yield* dependencies.ids.next
      const issuedAt = yield* dependencies.clock.now
      const number = yield* transaction.allocateDocumentNumber(context.organization.id, fiscalYear(document.issueDate), "invoice", document.series)
      const invoice: IssuedInvoice = {
        draftId: draft?.id ?? null, sourceProformaId: null,
        ...numberedSnapshot(document, issuer, { id: invoiceId, series: document.series, number, issuedAt }),
        eFacturaStatus: "not_sent",
      }
      yield* transaction.saveIssuedInvoice(invoice)
      if (draft !== undefined) yield* transaction.saveDraft({ ...draft, status: "issued" })
      yield* transaction.saveIdempotencyRecord(idempotencyRecord(
        context.organization.id, idempotency, operation, "invoice", invoice.id, issuedAt.toISOString(),
      ))
      return structuredClone(invoice)
    }))
  })

  const getIssuedInvoice = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const invoice = yield* transaction.findIssuedInvoice(context.organization.id, id)
      if (invoice === undefined) return yield* Effect.fail(missing("invoice", id))
      return structuredClone(invoice)
    }))
  })

  const listIssuedInvoices = (source?: DocumentSource) => Effect.gen(function*() {
    if (source !== undefined) yield* checked(() => { validateDocumentSource(source) })
    const context = yield* authorize(permissions.read)
    const invoices = yield* dependencies.store.transaction((transaction) =>
      transaction.listIssuedInvoices(context.organization.id, source))
    return structuredClone(invoices)
  })

  return { issueInvoice, getIssuedInvoice, listIssuedInvoices }
}
