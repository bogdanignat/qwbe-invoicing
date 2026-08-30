import type { Effect } from "effect"

import type { DomainConflict, PersistenceFailure } from "../contracts/failures.ts"
import type { Customer, DraftInvoice, IssuedInvoice, IssuerProfile } from "../domain/invoice.ts"
import type { Payment } from "../domain/payments.ts"

export type TransactionFailure = DomainConflict | PersistenceFailure

export interface InvoicingTransaction {
  readonly saveIssuer: (issuer: IssuerProfile) => Effect.Effect<void, TransactionFailure>
  readonly findIssuer: (organizationId: string) => Effect.Effect<IssuerProfile | undefined, PersistenceFailure>
  readonly saveCustomer: (customer: Customer) => Effect.Effect<void, TransactionFailure>
  readonly findCustomer: (
    organizationId: string,
    id: string,
  ) => Effect.Effect<Customer | undefined, PersistenceFailure>
  readonly saveDraft: (draft: DraftInvoice) => Effect.Effect<void, TransactionFailure>
  readonly findDraft: (
    organizationId: string,
    id: string,
  ) => Effect.Effect<DraftInvoice | undefined, PersistenceFailure>
  readonly allocateInvoiceNumber: (
    organizationId: string,
    fiscalYear: number,
    series: string,
  ) => Effect.Effect<number, TransactionFailure>
  readonly saveIssuedInvoice: (invoice: IssuedInvoice) => Effect.Effect<void, TransactionFailure>
  readonly findIssuedInvoice: (
    organizationId: string,
    id: string,
  ) => Effect.Effect<IssuedInvoice | undefined, PersistenceFailure>
  readonly savePayment: (payment: Payment) => Effect.Effect<void, TransactionFailure>
  readonly listPayments: (
    organizationId: string,
    invoiceId: string,
  ) => Effect.Effect<ReadonlyArray<Payment>, PersistenceFailure>
}
