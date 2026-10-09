import type { Effect } from "effect"

import type { ArtifactConflict, DocumentPersistenceFailure } from "../contracts/failures.ts"

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
