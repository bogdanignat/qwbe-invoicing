import type { Effect } from "effect"

import type { DocumentCursor, PageQuery, TransactionFailure } from "../../application/ports.ts"
import type { PersistenceFailure } from "../../contracts/failures.ts"
import type { DocumentSource } from "../../domain/invoice.ts"
import type { Proforma, ProformaConversion, ProformaInvoiceConversion, ProformaSummary } from "../domain/proforma.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write = Effect.Effect<void, TransactionFailure>
type Find<Value> = (organizationId: string, id: string) => Read<Value | undefined>

// Runs inside the same transaction as the rest of invoicing: the host composes this
// port with the kernel port over one connection, so a proforma and its conversion
// records commit or roll back with the numbering they consumed.
export interface ProformaTransaction {
  readonly saveProforma: (proforma: Proforma) => Write
  readonly findProforma: Find<Proforma>
  // At most limit + 1 rows in the registry order; `after` is the key of the last item of the previous page.
  readonly listProformas: (organizationId: string, page: PageQuery<DocumentCursor>, source?: DocumentSource) => Read<ReadonlyArray<ProformaSummary>>
  readonly findProformaConversion: Find<ProformaConversion>
  readonly saveProformaConversion: (conversion: ProformaConversion) => Write
  readonly findProformaInvoiceConversion: Find<ProformaInvoiceConversion>
  readonly saveProformaInvoiceConversion: (conversion: ProformaInvoiceConversion) => Write
}
