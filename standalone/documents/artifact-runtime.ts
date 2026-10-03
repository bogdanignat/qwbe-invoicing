import { Effect } from "effect"
import type { Pool } from "pg"

import {
  createArtifactService,
  type ArtifactService,
  type DocumentsFailure,
  type RequestContext,
} from "../../cube/invoicing/documents/index.ts"
import { createPdfObjectStore } from "./artifact-store.ts"
import { createPdfRenderer } from "./pdf-renderer.ts"
import { createPostgresArtifactRepository, createPostgresInvoiceSource } from "../storage/postgres-artifacts.ts"

/**
 * `dataDirectory` is the PDF object store and nothing else; metadata and the
 * source documents come from the pool the caller owns.
 */
export const createStandaloneArtifactService = (
  dataDirectory: string,
  pool: Pool,
  context: Effect.Effect<RequestContext, DocumentsFailure>,
): ArtifactService => createArtifactService({
  context,
  clock: Effect.sync(() => new Date()),
  repository: createPostgresArtifactRepository(pool),
  source: createPostgresInvoiceSource(pool),
  renderer: createPdfRenderer(),
  objects: createPdfObjectStore(dataDirectory),
  cubeIdentity: "documents",
})
