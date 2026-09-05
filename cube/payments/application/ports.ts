import type { Effect } from "effect"

import type { DomainConflict, PersistenceFailure } from "../contracts/failures.ts"
import type { Payment, PaymentIdempotencyRecord } from "../domain/payments.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write = Effect.Effect<void, DomainConflict | PersistenceFailure>
export interface InvoiceSnapshot {
  readonly id: string
  readonly organizationId: string
  readonly currency: string
  readonly dueDate: string | null
  readonly totalIncludingVat: string
}
export interface PaymentsTransaction {
  readonly findInvoiceSnapshot: (organizationId: string, invoiceId: string) => Read<InvoiceSnapshot | undefined>
  readonly savePayment: (payment: Payment) => Write
  readonly listPayments: (organizationId: string, invoiceId: string) => Read<ReadonlyArray<Payment>>
  readonly findPayment: (organizationId: string, invoiceId: string, paymentId: string) => Read<Payment | undefined>
  readonly findIdempotencyRecord: (organizationId: string, key: string) => Read<PaymentIdempotencyRecord | undefined>
  readonly saveIdempotencyRecord: (record: PaymentIdempotencyRecord) => Write
}
