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
  readonly invoiceId: string
}> {}

export type DocumentsFailure = DocumentsPermissionDenied | DocumentNotFound
  | DocumentPersistenceFailure | DocumentRenderingFailure | ArtifactConflict

export interface RequestContext {
  readonly identity: { readonly id: string; readonly permissions: ReadonlyArray<string> }
  readonly organization: { readonly id: string }
}

export interface RenderableParty {
  readonly legalName: string
  readonly taxIdentifier: string
  readonly address: {
    readonly countryCode: string
    readonly city: string
    readonly street: string
    readonly county?: string
    readonly postalCode?: string
  }
}

export interface RenderableLine {
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly taxRate: string
  readonly totalExcludingTax: string
  readonly taxAmount: string
  readonly totalIncludingTax: string
}

export interface RenderableInvoice {
  readonly id: string
  readonly organizationId: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string
  readonly issuedAt: string
  readonly currency: string
  readonly issuer: RenderableParty
  readonly customer: RenderableParty
  readonly lines: ReadonlyArray<RenderableLine>
  readonly taxBreakdown: ReadonlyArray<{
    readonly rate: string
    readonly taxableAmount: string
    readonly taxAmount: string
  }>
  readonly totalExcludingTax: string
  readonly taxTotal: string
  readonly totalIncludingTax: string
}

export interface InvoiceSource {
  readonly findInvoice: (
    organizationId: string,
    invoiceId: string,
  ) => Effect.Effect<RenderableInvoice | undefined, DocumentPersistenceFailure>
  readonly listIssuedInvoiceIds: (
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

export interface StoredPdf {
  readonly objectKey: string
  readonly sha256: string
  readonly byteLength: number
}

export interface PdfObjectStore {
  readonly putPdf: (bytes: Uint8Array) => Effect.Effect<StoredPdf, DocumentPersistenceFailure>
  readonly readPdf: (artifact: InvoiceArtifact) => Effect.Effect<Uint8Array, DocumentPersistenceFailure>
}

export interface ArtifactRepository {
  readonly findArtifact: (
    organizationId: string,
    invoiceId: string,
  ) => Effect.Effect<InvoiceArtifact | undefined, DocumentPersistenceFailure>
  readonly saveArtifact: (
    artifact: InvoiceArtifact,
  ) => Effect.Effect<InvoiceArtifact, DocumentPersistenceFailure | ArtifactConflict>
}
