import { Data, type Effect } from "effect"

export class DocumentsPermissionDenied extends Data.TaggedError("DocumentsPermissionDenied")<{
  readonly permission: string
}> {}
export class DocumentNotFound extends Data.TaggedError("DocumentNotFound")<{
  readonly resource: string
  readonly id: string
}> {}
export class DocumentPersistenceFailure extends Data.TaggedError("DocumentPersistenceFailure")<{
  readonly operation: string
}> {}
export class DocumentRenderingFailure extends Data.TaggedError("DocumentRenderingFailure")<{
  readonly template: string
}> {}
export class ArtifactConflict extends Data.TaggedError("ArtifactConflict")<{
  readonly documentKind: DocumentKind
  readonly documentId: string
}> {}

export type DocumentsFailure = DocumentsPermissionDenied | DocumentNotFound
  | DocumentPersistenceFailure | DocumentRenderingFailure | ArtifactConflict

export interface RequestContext {
  readonly identity: { readonly id: string; readonly permissions: ReadonlyArray<string> }
  readonly organization: { readonly id: string }
}

export interface RenderableParty {
  readonly partyType?: "company" | "individual"
  readonly name: string
  readonly fiscalIdentifier: string
  readonly address: {
    readonly countryCode: string
    readonly city: string
    readonly street: string
    readonly county?: string
    readonly postalCode?: string
  }
}

export interface RenderableBuyer extends RenderableParty {
  readonly partyType: "company" | "individual"
}

export interface RenderableLine {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: { readonly code: string; readonly name: string }
  readonly vatRate: string
  readonly totalExcludingVat: string
  readonly vatAmount: string
  readonly totalIncludingVat: string
}

export type DocumentKind = "invoice" | "proforma"

interface RenderableNumberedDocument {
  readonly id: string
  readonly organizationId: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string | null
  readonly issuedAt: string
  readonly currency: string
  readonly issuer: RenderableParty
  readonly customer: RenderableBuyer
  readonly lines: ReadonlyArray<RenderableLine>
  readonly vatBreakdown: ReadonlyArray<{
    readonly rate: string
    readonly vatBaseAmount: string
    readonly vatAmount: string
  }>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
}

export type RenderableInvoice = RenderableNumberedDocument

export interface RenderableProforma extends RenderableNumberedDocument {
  readonly sourceDraftId: string | null
  readonly invoiceSeries: string
  readonly convertedDraftId: string | null
  readonly convertedInvoiceId: string | null
}

export interface InvoiceSource {
  readonly findInvoice: (
    organizationId: string,
    invoiceId: string,
  ) => Effect.Effect<RenderableInvoice | undefined, DocumentPersistenceFailure>
  readonly listIssuedInvoiceIds: (
    organizationId: string,
  ) => Effect.Effect<ReadonlyArray<string>, DocumentPersistenceFailure>
  readonly findProforma: (
    organizationId: string,
    proformaId: string,
  ) => Effect.Effect<RenderableProforma | undefined, DocumentPersistenceFailure>
  readonly listProformaIds: (
    organizationId: string,
  ) => Effect.Effect<ReadonlyArray<string>, DocumentPersistenceFailure>
}

export interface RenderedDocument {
  readonly bytes: Uint8Array
  readonly mediaType: "application/pdf"
  readonly templateVersion: string
}

export interface InvoiceRenderer {
  readonly render: (invoice: RenderableInvoice) => Effect.Effect<RenderedDocument, DocumentRenderingFailure>
  readonly renderProforma: (proforma: RenderableProforma) => Effect.Effect<RenderedDocument, DocumentRenderingFailure>
}

export interface InvoiceArtifact {
  readonly invoiceId: string
  readonly organizationId: string
  readonly objectKey: string
  readonly sha256: string
  readonly byteLength: number
  readonly mediaType: "application/pdf"
  readonly templateVersion: string
  readonly generatedAt: string
}

export interface ProformaArtifact {
  readonly proformaId: string
  readonly organizationId: string
  readonly objectKey: string
  readonly sha256: string
  readonly byteLength: number
  readonly mediaType: "application/pdf"
  readonly templateVersion: string
  readonly generatedAt: string
}

export type PdfArtifact = InvoiceArtifact | ProformaArtifact

export interface StoredPdf {
  readonly objectKey: string
  readonly sha256: string
  readonly byteLength: number
}

export interface PdfObjectStore {
  readonly putPdf: (bytes: Uint8Array) => Effect.Effect<StoredPdf, DocumentPersistenceFailure>
  readonly readPdf: (artifact: PdfArtifact) => Effect.Effect<Uint8Array, DocumentPersistenceFailure>
}

export interface ArtifactRepository {
  readonly findArtifact: (
    organizationId: string,
    invoiceId: string,
  ) => Effect.Effect<InvoiceArtifact | undefined, DocumentPersistenceFailure>
  readonly saveArtifact: (
    artifact: InvoiceArtifact,
  ) => Effect.Effect<InvoiceArtifact, DocumentPersistenceFailure | ArtifactConflict>
  readonly findProformaArtifact: (
    organizationId: string,
    proformaId: string,
  ) => Effect.Effect<ProformaArtifact | undefined, DocumentPersistenceFailure>
  readonly saveProformaArtifact: (
    artifact: ProformaArtifact,
  ) => Effect.Effect<ProformaArtifact, DocumentPersistenceFailure | ArtifactConflict>
}
