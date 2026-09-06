const identity = "documents"

// Child cube: reading and rendering artifacts is covered by the parent's read permission.
export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    tables: ["invoice_artifacts", "proforma_artifacts"],
    requiresAuth: true,
    permissions: [],
  },
}

export { createArtifactService } from "./application/artifacts.ts"
export { documentsMigrations } from "./contracts/migrations.ts"
export type { DocumentsMigration } from "./contracts/migrations.ts"
export type { ArtifactService, ArtifactServiceDependencies } from "./application/artifacts.ts"
export {
  ArtifactConflict,
  DocumentNotFound,
  DocumentPersistenceFailure,
  DocumentRenderingFailure,
  DocumentsPermissionDenied,
} from "./application/artifact-ports.ts"
export type {
  ArtifactRepository,
  DocumentsFailure,
  InvoiceArtifact,
  InvoiceRenderer,
  InvoiceSource,
  PdfArtifact,
  PdfObjectStore,
  ProformaArtifact,
  RenderableInvoice,
  RenderableProforma,
  RenderableBuyer,
  RenderableParty,
  RenderedDocument,
  RequestContext,
  StoredPdf,
} from "./application/artifact-ports.ts"
