import { Effect } from "effect"

import { checked, recordAuditEvent, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSeries } from "../../domain/invoice.ts"
import type { ConfigureDocumentSeriesInput } from "../../domain/inputs.ts"
import { validateDocumentSeries } from "../../domain/validation.ts"

export interface DocumentSeriesOperations {
  readonly addDocumentSeries: (input: ConfigureDocumentSeriesInput) => Effect.Effect<DocumentSeries, InvoicingFailure>
  readonly listDocumentSeries: () => Effect.Effect<ReadonlyArray<DocumentSeries>, InvoicingFailure>
}

export const createDocumentSeriesOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): DocumentSeriesOperations => {
  const addDocumentSeries = (input: ConfigureDocumentSeriesInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const now = yield* dependencies.clock.now
    const series: DocumentSeries = { organizationId: context.organization.id, ...input }
    yield* checked(() => { validateDocumentSeries(series) })
    yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      yield* transaction.addDocumentSeries(series)
      yield* recordAuditEvent(transaction, context, dependencies.ids, now, {
        action: "series.added", targetKind: "document_series", targetId: `${series.documentType}:${series.series}`,
      })
    }))
    return structuredClone(series)
  })
  const listDocumentSeries = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listDocumentSeries(context.organization.id)))
  })
  return { addDocumentSeries, listDocumentSeries }
}
