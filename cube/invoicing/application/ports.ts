import type { Effect } from "effect"

import type { DomainConflict, PersistenceFailure } from "../contracts/failures.ts"
import type { Customer, DocumentSeries, DocumentType, DraftInvoice, IssuedInvoice, IssuerProfile, NumberedDocumentType, Proforma, ProformaConversion, ProformaInvoiceConversion } from "../domain/invoice.ts"
import type { CorrectionDocument } from "../domain/corrections.ts"
import type { Payment } from "../domain/payments.ts"

export type TransactionFailure = DomainConflict | PersistenceFailure
type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write<Value = void> = Effect.Effect<Value, TransactionFailure>
type Save<Value> = (value: Value) => Write
type Find<Value> = (organizationId: string, id: string) => Read<Value | undefined>
type List<Value> = (organizationId: string) => Read<ReadonlyArray<Value>>
type RelatedList<Value> = (organizationId: string, parentId: string) => Read<ReadonlyArray<Value>>
type Remove = (organizationId: string, id: string) => Write

export interface InvoicingTransaction {
  readonly saveIssuer: Save<IssuerProfile>
  readonly findIssuer: (organizationId: string) => Read<IssuerProfile | undefined>
  readonly addDocumentSeries: Save<DocumentSeries>
  readonly findDocumentSeries: (
    organizationId: string,
    documentType: DocumentType,
    series: string,
  ) => Read<DocumentSeries | undefined>
  readonly listDocumentSeries: List<DocumentSeries>
  readonly saveCustomer: Save<Customer>
  readonly findCustomer: Find<Customer>
  readonly listCustomers: List<Customer>
  readonly softDeleteCustomer: (
    organizationId: string,
    id: string,
    deletedAt: string,
  ) => Write
  readonly hasOpenDraftsForCustomer: (organizationId: string, customerId: string) => Read<boolean>
  readonly saveDraft: Save<DraftInvoice>
  readonly findDraft: Find<DraftInvoice>
  readonly listDrafts: List<DraftInvoice>
  readonly deleteDraft: Remove
  readonly allocateDocumentNumber: (
    organizationId: string,
    fiscalYear: number,
    documentType: NumberedDocumentType,
    series: string,
  ) => Write<number>
  readonly saveIssuedInvoice: Save<IssuedInvoice>
  readonly findIssuedInvoice: Find<IssuedInvoice>
  readonly listIssuedInvoices: List<IssuedInvoice>
  readonly savePayment: Save<Payment>
  readonly listPayments: RelatedList<Payment>
  readonly saveProforma: Save<Proforma>
  readonly findProforma: Find<Proforma>
  readonly listProformas: List<Proforma>
  readonly findProformaConversion: Find<ProformaConversion>
  readonly findProformaInvoiceConversion: Find<ProformaInvoiceConversion>
  readonly saveProformaInvoiceConversion: Save<ProformaInvoiceConversion>
  readonly saveCorrection: Save<CorrectionDocument>
  readonly findCorrection: Find<CorrectionDocument>
  readonly listCorrections: RelatedList<CorrectionDocument>
}
