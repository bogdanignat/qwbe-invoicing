import type { Effect } from "effect"

import type { InvoicingTransaction, TransactionFailure } from "../../application/ports.ts"
import type { PageQuery } from "../../application/ports.ts"
import type { PersistenceFailure } from "../../contracts/failures.ts"
import type { DocumentSource } from "../../domain/invoice.ts"
import type { CorrectionDocument } from "../domain/corrections.ts"
import type { InvoiceRegisterCursor, InvoiceRegisterRow } from "../domain/register.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write = Effect.Effect<void, TransactionFailure>

// Runs inside the same transaction as the rest of invoicing: the host composes this
// port with the kernel port over one connection, so a correction commits or rolls
// back with the invoice number it consumed.
export interface CorrectionsTransaction {
  readonly saveCorrection: (correction: CorrectionDocument) => Write
  readonly findCorrection: (organizationId: string, id: string) => Read<CorrectionDocument | undefined>
  readonly listCorrections: (organizationId: string, invoiceId: string, source?: DocumentSource) => Read<ReadonlyArray<CorrectionDocument>>
  readonly listInvoiceRegister: (organizationId: string, page: PageQuery<InvoiceRegisterCursor>, source?: DocumentSource) => Read<ReadonlyArray<InvoiceRegisterRow>>
}

// What a correction operation works on: the kernel port for numbering, invoices and audit, plus its own.
export type CorrectionWork = InvoicingTransaction & CorrectionsTransaction
