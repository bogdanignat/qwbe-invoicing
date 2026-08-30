const identity = "documents"

export const documentsPermissions = {
  read: `${identity}:read`,
  render: `${identity}:render`,
}

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    tables: ["invoice_artifacts"],
    requiresAuth: true,
    permissions: [
      { name: documentsPermissions.read, roles: ["admin"] },
      { name: documentsPermissions.render, roles: ["admin"] },
    ],
  },
  create: () => ({ handlers: {} }),
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
  PdfObjectStore,
  RenderableInvoice,
  RenderedDocument,
  RequestContext,
  StoredPdf,
} from "./application/artifact-ports.ts"
