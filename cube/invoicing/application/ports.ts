import type { Effect } from "effect"

import type { DomainConflict, PersistenceFailure } from "../contracts/failures.ts"
import type { AuditEvent, DocumentSeries, DocumentSource, DocumentType, DraftInvoice, IdempotencyRecord, IssuedInvoice, IssuedInvoiceSummary, NumberedDocumentType } from "../domain/invoice.ts"

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
type Remove = (organizationId: string, id: string) => Write

export interface InvoicingTransaction {
  readonly addDocumentSeries: Save<DocumentSeries>
  readonly findDocumentSeries: (
    organizationId: string,
    documentType: DocumentType,
    series: string,
  ) => Read<DocumentSeries | undefined>
  readonly listDocumentSeries: List<DocumentSeries>
  readonly saveDraft: Save<DraftInvoice>
  readonly findDraft: Find<DraftInvoice>
  readonly listDrafts: PagedList<DraftInvoice, DraftCursor>
  readonly deleteDraft: Remove
  // Highest issue date already numbered in (organization, fiscal year, series) for the given document type;
  // corrections count as invoices because they are numbered in the invoice series (Codul fiscal art. 330).
  readonly findLatestIssueDate: (
    organizationId: string,
    fiscalYear: number,
    documentType: NumberedDocumentType,
    series: string,
  ) => Read<string | undefined>
  readonly allocateDocumentNumber: (
    organizationId: string,
    fiscalYear: number,
    documentType: NumberedDocumentType,
    series: string,
  ) => Write<number>
  readonly saveIssuedInvoice: Save<IssuedInvoice>
  readonly findIssuedInvoice: Find<IssuedInvoice>
  readonly listIssuedInvoices: PagedList<IssuedInvoiceSummary, DocumentCursor>
  readonly findIdempotencyRecord: Find<IdempotencyRecord>
  readonly saveIdempotencyRecord: Save<IdempotencyRecord>
  readonly appendAuditEvent: Save<AuditEvent>
}
