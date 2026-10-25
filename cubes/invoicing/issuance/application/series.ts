import { Effect } from "effect"

import { checked, missing, recordAuditEvent, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSeries } from "../../domain/invoice.ts"
import type { ConfigureDocumentSeriesInput } from "../../domain/inputs.ts"
import { validateDocumentSeries } from "../../domain/validation.ts"

export type ArchiveDocumentSeriesInput = ConfigureDocumentSeriesInput & { readonly archived: boolean }

export interface DocumentSeriesOperations {
  readonly addDocumentSeries: (input: ConfigureDocumentSeriesInput) => Effect.Effect<DocumentSeries, InvoicingFailure>
  readonly listDocumentSeries: () => Effect.Effect<ReadonlyArray<DocumentSeries>, InvoicingFailure>
  /** Archive or reactivate: the same state again is answered as it is, with nothing written. */
  readonly setDocumentSeriesArchived: (input: ArchiveDocumentSeriesInput) => Effect.Effect<DocumentSeries, InvoicingFailure>
}

export const createDocumentSeriesOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): DocumentSeriesOperations => {
  const addDocumentSeries = (input: ConfigureDocumentSeriesInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const now = yield* dependencies.clock.now
    const series: DocumentSeries = { organizationId: context.organization.id, ...input, archived: false }
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
  const setDocumentSeriesArchived = ({ documentType, series, archived }: ArchiveDocumentSeriesInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    yield* checked(() => { validateDocumentSeries({ documentType, series }) })
    const now = yield* dependencies.clock.now
    return structuredClone(yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const current = yield* transaction.findDocumentSeries(context.organization.id, documentType, series)
      if (current === undefined) return yield* Effect.fail(missing("document_series", series))
      if (current.archived === archived) return current
      const updated = { ...current, archived }
      yield* transaction.setDocumentSeriesArchived(updated)
      yield* recordAuditEvent(transaction, context, dependencies.ids, now, {
        action: archived ? "series.archived" : "series.reactivated", targetKind: "document_series", targetId: `${documentType}:${series}`,
      })
      return updated
    })))
  })
  return { addDocumentSeries, listDocumentSeries, setDocumentSeriesArchived }
}
