import type { Effect } from "effect"

import type { DomainConflict, PersistenceFailure } from "../contracts/failures.ts"
import type { Customer, DocumentSeries, DocumentSource, DocumentType, DraftInvoice, IdempotencyRecord, IssuedInvoice, IssuerProfile, NumberedDocumentType, ProductPreset, Proforma, ProformaConversion, ProformaInvoiceConversion } from "../domain/invoice.ts"
import type { CorrectionDocument } from "../corrections/domain/corrections.ts"

export interface PageQuery<Key> {
  readonly limit: number
  readonly after?: Key
}
export interface DocumentCursor { readonly issueDate: string; readonly number: number; readonly id: string }
export interface DraftCursor { readonly issueDate: string; readonly id: string }
export interface NameCursor { readonly name: string; readonly id: string }

export type TransactionFailure = DomainConflict | PersistenceFailure
type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write<Value = void> = Effect.Effect<Value, TransactionFailure>
type Save<Value> = (value: Value) => Write
type Find<Value> = (organizationId: string, id: string) => Read<Value | undefined>
type List<Value> = (organizationId: string, source?: DocumentSource) => Read<ReadonlyArray<Value>>
// Paged reads return at most limit + 1 rows in the registry order; `after` is the key of the last item of the previous page.
type PagedList<Value, Key> = (organizationId: string, page: PageQuery<Key>, source?: DocumentSource) => Read<ReadonlyArray<Value>>
type RelatedList<Value> = (organizationId: string, parentId: string, source?: DocumentSource) => Read<ReadonlyArray<Value>>
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
  readonly listCustomers: (organizationId: string, page: PageQuery<NameCursor>) => Read<ReadonlyArray<Customer>>
  readonly softDeleteCustomer: (
    organizationId: string,
    id: string,
    deletedAt: string,
  ) => Write
  readonly hasOpenDraftsForCustomer: (organizationId: string, customerId: string) => Read<boolean>
  readonly saveProductPreset: Save<ProductPreset>
  readonly findProductPreset: Find<ProductPreset>
  readonly listProductPresets: (organizationId: string, page: PageQuery<NameCursor>) => Read<ReadonlyArray<ProductPreset>>
  readonly deleteProductPreset: Remove
  readonly saveDraft: Save<DraftInvoice>
  readonly findDraft: Find<DraftInvoice>
  readonly listDrafts: PagedList<DraftInvoice, DraftCursor>
  readonly deleteDraft: Remove
  readonly allocateDocumentNumber: (
    organizationId: string,
    fiscalYear: number,
    documentType: NumberedDocumentType,
    series: string,
  ) => Write<number>
  readonly saveIssuedInvoice: Save<IssuedInvoice>
  readonly findIssuedInvoice: Find<IssuedInvoice>
  readonly listIssuedInvoices: PagedList<IssuedInvoice, DocumentCursor>
  readonly saveProforma: Save<Proforma>
  readonly findProforma: Find<Proforma>
  readonly listProformas: PagedList<Proforma, DocumentCursor>
  readonly findProformaConversion: Find<ProformaConversion>
  readonly findProformaInvoiceConversion: Find<ProformaInvoiceConversion>
  readonly saveProformaInvoiceConversion: Save<ProformaInvoiceConversion>
  readonly saveCorrection: Save<CorrectionDocument>
  readonly findCorrection: Find<CorrectionDocument>
  readonly listCorrections: RelatedList<CorrectionDocument>
  readonly findIdempotencyRecord: Find<IdempotencyRecord>
  readonly saveIdempotencyRecord: Save<IdempotencyRecord>
}
