import { Effect } from "effect"

import type { InvoicingTransaction } from "../../application/ports.ts"
import { missing } from "../../application/support.ts"
import { DomainConflict } from "../../contracts/failures.ts"
import type { DocumentType } from "../../domain/invoice.ts"

export const documentSeriesArchived = "document_series_archived"

/**
 * The series a new document may start in: configured and not archived. It is
 * asked where a document is authored or numbered for the first time; a storno
 * stays in the series of the invoice it corrects, archived or not, so the
 * numbering itself (`allocateDocumentNumber`) never asks.
 */
export const activeDocumentSeries = (
  transaction: InvoicingTransaction, organizationId: string, documentType: DocumentType, series: string,
) => Effect.gen(function*() {
  const found = yield* transaction.findDocumentSeries(organizationId, documentType, series)
  if (found === undefined) return yield* Effect.fail(missing("document_series", series))
  if (found.archived) return yield* Effect.fail(new DomainConflict({
    code: documentSeriesArchived, message: `Document series ${series} is archived`,
  }))
  return found
})
