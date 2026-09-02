import type { Effect } from "effect"

import type { DomainConflict, PersistenceFailure } from "../contracts/failures.ts"
import type { Customer, DocumentSeries, DocumentType, DraftInvoice, IssuedInvoice, IssuerProfile } from "../domain/invoice.ts"
import type { CorrectionDocument } from "../domain/corrections.ts"
import type { Payment } from "../domain/payments.ts"

export type TransactionFailure = DomainConflict | PersistenceFailure

export interface InvoicingTransaction {
  readonly saveIssuer: (issuer: IssuerProfile) => Effect.Effect<void, TransactionFailure>
  readonly findIssuer: (organizationId: string) => Effect.Effect<IssuerProfile | undefined, PersistenceFailure>
  readonly addDocumentSeries: (documentSeries: DocumentSeries) => Effect.Effect<void, TransactionFailure>
  readonly findDocumentSeries: (
    organizationId: string,
    documentType: DocumentType,
    series: string,
  ) => Effect.Effect<DocumentSeries | undefined, PersistenceFailure>
  readonly listDocumentSeries: (
    organizationId: string,
  ) => Effect.Effect<ReadonlyArray<DocumentSeries>, PersistenceFailure>
  readonly saveCustomer: (customer: Customer) => Effect.Effect<void, TransactionFailure>
  readonly findCustomer: (
    organizationId: string,
    id: string,
  ) => Effect.Effect<Customer | undefined, PersistenceFailure>
  readonly listCustomers: (
    organizationId: string,
  ) => Effect.Effect<ReadonlyArray<Customer>, PersistenceFailure>
  readonly softDeleteCustomer: (
    organizationId: string,
    id: string,
    deletedAt: string,
  ) => Effect.Effect<void, TransactionFailure>
  readonly hasOpenDraftsForCustomer: (
    organizationId: string,
    customerId: string,
  ) => Effect.Effect<boolean, PersistenceFailure>
  readonly saveDraft: (draft: DraftInvoice) => Effect.Effect<void, TransactionFailure>
  readonly findDraft: (
    organizationId: string,
    id: string,
  ) => Effect.Effect<DraftInvoice | undefined, PersistenceFailure>
  readonly listDrafts: (
    organizationId: string,
  ) => Effect.Effect<ReadonlyArray<DraftInvoice>, PersistenceFailure>
  readonly deleteDraft: (
    organizationId: string,
    id: string,
  ) => Effect.Effect<void, TransactionFailure>
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
  readonly listIssuedInvoices: (
    organizationId: string,
  ) => Effect.Effect<ReadonlyArray<IssuedInvoice>, PersistenceFailure>
  readonly savePayment: (payment: Payment) => Effect.Effect<void, TransactionFailure>
  readonly listPayments: (
    organizationId: string,
    invoiceId: string,
  ) => Effect.Effect<ReadonlyArray<Payment>, PersistenceFailure>
  readonly allocateCorrectionNumber: (
    organizationId: string,
    fiscalYear: number,
    series: string,
  ) => Effect.Effect<number, TransactionFailure>
  readonly saveCorrection: (correction: CorrectionDocument) => Effect.Effect<void, TransactionFailure>
  readonly findCorrection: (
    organizationId: string,
    id: string,
  ) => Effect.Effect<CorrectionDocument | undefined, PersistenceFailure>
  readonly listCorrections: (
    organizationId: string,
    originalInvoiceId: string,
  ) => Effect.Effect<ReadonlyArray<CorrectionDocument>, PersistenceFailure>
}
