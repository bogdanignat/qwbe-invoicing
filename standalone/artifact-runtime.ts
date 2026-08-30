import { Effect } from "effect"

import {
  createArtifactService,
  type ArtifactService,
  type DocumentsFailure,
  type RequestContext,
} from "../cube/invoicing/documents/index.ts"
import { createPdfObjectStore } from "./artifact-store.ts"
import { createPdfRenderer } from "./pdf-renderer.ts"
import { createArtifactRepository, createInvoiceSource } from "./sqlite-artifacts.ts"

export const createStandaloneArtifactService = (
  dataDirectory: string,
  context: Effect.Effect<RequestContext, DocumentsFailure>,
): ArtifactService => createArtifactService({
  context,
  clock: Effect.sync(() => new Date()),
  repository: createArtifactRepository(dataDirectory),
  source: createInvoiceSource(dataDirectory),
  renderer: createPdfRenderer(),
  objects: createPdfObjectStore(dataDirectory),
  cubeIdentity: "documents",
})
