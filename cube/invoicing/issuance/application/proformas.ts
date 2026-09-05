import { Effect } from "effect"

import { findIdempotencyReplay, idempotencyRecord, missingIdempotencyResult } from "../../application/idempotency.ts"
import { checked, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSource, Idempotent, Proforma } from "../../domain/invoice.ts"
import type { AuthoringProformaInput, IssueProformaInput } from "../../domain/inputs.ts"
import { validateDocumentSource } from "../../domain/validation.ts"
import { fiscalYear, issuanceSource, numberedSnapshot } from "./snapshot.ts"

export interface ProformaOperations {
  readonly issueProforma: (input: Idempotent<AuthoringProformaInput | IssueProformaInput>) => Effect.Effect<Proforma, InvoicingFailure>
  readonly getProforma: (id: string) => Effect.Effect<Proforma, InvoicingFailure>
  readonly listProformas: (source?: DocumentSource) => Effect.Effect<ReadonlyArray<Proforma>, InvoicingFailure>
}

export const createProformaOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): ProformaOperations => {
  const issueProforma = ({ request: input, idempotency }: Idempotent<AuthoringProformaInput | IssueProformaInput>) => Effect.gen(function*() {
    const context = yield* authorize(permissions.issueProformas)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const operation = "draftId" in input ? "issue_proforma_from_draft" : "issue_proforma_direct"
      const replayId = yield* findIdempotencyReplay(transaction, context.organization.id, idempotency, operation, "proforma")
      if (replayId !== undefined) {
        const replay = yield* transaction.findProforma(context.organization.id, replayId)
        return replay === undefined ? yield* Effect.fail(missingIdempotencyResult("proforma")) : structuredClone(replay)
      }
      const { document, issuer, draft } = yield* issuanceSource(input, context.organization.id, transaction, dependencies.ids, "proforma")
      const id = yield* dependencies.ids.next
      const issuedAt = yield* dependencies.clock.now
      const proformaSeries = "draftId" in input ? input.series : input.proformaSeries
      const series = yield* transaction.findDocumentSeries(context.organization.id, "proforma", proformaSeries)
      if (series === undefined) return yield* Effect.fail(missing("document_series", proformaSeries))
      const proforma: Proforma = {
        sourceDraftId: draft?.id ?? null, invoiceSeries: document.series, convertedDraftId: null, convertedInvoiceId: null,
        ...numberedSnapshot(document, issuer, { id, series: series.series,
          number: yield* transaction.allocateDocumentNumber(context.organization.id, fiscalYear(document.issueDate), "proforma", series.series),
          issuedAt }),
      }
      yield* transaction.saveProforma(proforma)
      if (draft !== undefined) yield* transaction.saveDraft({ ...draft, status: "proforma_issued" })
      yield* transaction.saveIdempotencyRecord(idempotencyRecord(
        context.organization.id, idempotency, operation, "proforma", proforma.id, issuedAt.toISOString(),
      ))
      return structuredClone(proforma)
    }))
  })

  const getProforma = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const value = yield* dependencies.store.transaction((transaction) => transaction.findProforma(context.organization.id, id))
    return value === undefined ? yield* Effect.fail(missing("proforma", id)) : structuredClone(value)
  })

  const listProformas = (source?: DocumentSource) => Effect.gen(function*() {
    if (source !== undefined) yield* checked(() => { validateDocumentSource(source) })
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listProformas(context.organization.id, source)))
  })

  return { issueProforma, getProforma, listProformas }
}
