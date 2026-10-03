import { Effect } from "effect"
import type { Pool } from "pg"

import {
  ArtifactConflict, DocumentPersistenceFailure, type ArtifactRepository,
} from "../../cube/invoicing/documents/index.ts"
import {
  artifactFrom, artifactRow, proformaArtifactFrom, sameArtifact, sameProformaArtifact,
} from "./postgres-artifact-rows.ts"
import { documentsLockKey, transactionWith, type TransactionClient } from "./postgres-transaction.ts"

/**
 * Artifact metadata in PostgreSQL, on the documents lock.
 *
 * What stays filesystem-shaped: the PDF itself. It is content-addressed under
 * `DATA_DIR` and written by `PdfObjectStore`, not here, so metadata and bytes
 * are two stores and there is NO cross-store atomicity — exactly as before. The
 * recovery that makes it safe is the same one: the row is the index, an orphan
 * object is inert, and a row whose object is missing is a read failure.
 *
 * Idempotent save, as the SQLite version was: an existing row for the same
 * document is compared field by field. Identical means "already done" and the
 * stored row is returned; different means `ArtifactConflict`, which the
 * transaction's failure rolls back.
 */

const failure = (operation: string) => new DocumentPersistenceFailure({ operation })

const documentsTransaction = (pool: Pool, operation: string) => transactionWith(pool, {
  lock: documentsLockKey,
  adapter: (client: TransactionClient) => client,
  onBeginFailure: () => failure(operation),
  onCommitFailure: () => failure(operation),
})

/** A read: it cannot conflict, so the error channel stays a single failure. */
const attemptRead = <Value>(operation: string, run: () => Promise<Value>) =>
  Effect.tryPromise({ try: run, catch: () => failure(operation) })

/** A save: `ArtifactConflict` is a domain answer and travels as itself. */
const attempt = <Value>(operation: string, run: () => Promise<Value>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => error instanceof ArtifactConflict ? error : failure(operation),
  })

export const createPostgresArtifactRepository = (pool: Pool): ArtifactRepository => ({
  findArtifact: (organizationId, invoiceId) =>
    documentsTransaction(pool, "find artifact")((client) => attemptRead("find artifact", async () => {
      const { rows } = await client.query(
        "SELECT * FROM invoice_artifacts WHERE organization_id = $1 AND invoice_id = $2",
        [organizationId, invoiceId],
      )
      const value = artifactRow(rows[0])
      return value === undefined ? undefined : artifactFrom(value)
    })),
  saveArtifact: (artifact) =>
    documentsTransaction(pool, "save artifact")((client) => attempt("save artifact", async () => {
      const existingRows = await client.query(
        "SELECT * FROM invoice_artifacts WHERE invoice_id = $1", [artifact.invoiceId],
      )
      const value = artifactRow(existingRows.rows[0])
      if (value !== undefined) {
        const existing = artifactFrom(value)
        if (!sameArtifact(existing, artifact)) {
          throw new ArtifactConflict({ documentKind: "invoice", documentId: artifact.invoiceId })
        }
        return existing
      }
      await client.query(
        `INSERT INTO invoice_artifacts
          (invoice_id, organization_id, object_key, sha256, byte_length, media_type, template_version, generated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [artifact.invoiceId, artifact.organizationId, artifact.objectKey, artifact.sha256,
          artifact.byteLength, artifact.mediaType, artifact.templateVersion, artifact.generatedAt],
      )
      return artifact
    })),
  findProformaArtifact: (organizationId, proformaId) =>
    documentsTransaction(pool, "find proforma artifact")((client) =>
      attemptRead("find proforma artifact", async () => {
        const { rows } = await client.query(
          "SELECT * FROM proforma_artifacts WHERE organization_id = $1 AND proforma_id = $2",
          [organizationId, proformaId],
        )
        const value = artifactRow(rows[0])
        return value === undefined ? undefined : proformaArtifactFrom(value)
      })),
  saveProformaArtifact: (artifact) =>
    documentsTransaction(pool, "save proforma artifact")((client) =>
      attempt("save proforma artifact", async () => {
        const existingRows = await client.query(
          "SELECT * FROM proforma_artifacts WHERE proforma_id = $1", [artifact.proformaId],
        )
        const value = artifactRow(existingRows.rows[0])
        if (value !== undefined) {
          const existing = proformaArtifactFrom(value)
          if (!sameProformaArtifact(existing, artifact)) {
            throw new ArtifactConflict({ documentKind: "proforma", documentId: artifact.proformaId })
          }
          return existing
        }
        await client.query(
          `INSERT INTO proforma_artifacts
            (proforma_id, organization_id, object_key, sha256, byte_length, media_type, template_version, generated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [artifact.proformaId, artifact.organizationId, artifact.objectKey, artifact.sha256,
            artifact.byteLength, artifact.mediaType, artifact.templateVersion, artifact.generatedAt],
        )
        return artifact
      })),
})
