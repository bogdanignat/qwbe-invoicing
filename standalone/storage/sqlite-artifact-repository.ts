import { DatabaseSync } from "node:sqlite"

import { Effect } from "effect"

import {
  ArtifactConflict, DocumentPersistenceFailure, type ArtifactRepository,
} from "../../cube/invoicing/documents/index.ts"
import { documentsDatabasePath } from "./migrations.ts"
import {
  artifactFrom, artifactRow, proformaArtifactFrom, sameArtifact, sameProformaArtifact,
} from "./sqlite-artifact-rows.ts"

const failure = (operation: string) => new DocumentPersistenceFailure({ operation })
const attempt = <Value>(operation: string, run: () => Value) => Effect.try({ try: run, catch: () => failure(operation) })

export const createArtifactRepository = (dataDirectory: string): ArtifactRepository => ({
  findArtifact: (organizationId, invoiceId) => attempt("find artifact", () => {
    const database = new DatabaseSync(documentsDatabasePath(dataDirectory), { readOnly: true })
    try {
      const value = artifactRow(database.prepare(
        "SELECT * FROM invoice_artifacts WHERE organization_id = ? AND invoice_id = ?",
      ).get(organizationId, invoiceId))
      return value === undefined ? undefined : artifactFrom(value)
    } finally { database.close() }
  }),
  saveArtifact: (artifact) => Effect.try({
    try: () => {
      const database = new DatabaseSync(documentsDatabasePath(dataDirectory))
      let open = false
      try {
        database.exec("BEGIN IMMEDIATE")
        open = true
        const value = artifactRow(database.prepare("SELECT * FROM invoice_artifacts WHERE invoice_id = ?").get(artifact.invoiceId))
        if (value !== undefined) {
          const existing = artifactFrom(value)
          if (!sameArtifact(existing, artifact)) throw new ArtifactConflict({ documentKind: "invoice", documentId: artifact.invoiceId })
          database.exec("ROLLBACK")
          open = false
          return existing
        }
        database.prepare(`INSERT INTO invoice_artifacts
          (invoice_id, organization_id, object_key, sha256, byte_length, media_type, template_version, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(artifact.invoiceId, artifact.organizationId, artifact.objectKey,
          artifact.sha256, artifact.byteLength, artifact.mediaType, artifact.templateVersion, artifact.generatedAt)
        database.exec("COMMIT")
        open = false
        return artifact
      } finally {
        if (open) database.exec("ROLLBACK")
        database.close()
      }
    },
    catch: (error) => error instanceof ArtifactConflict ? error : failure("save artifact"),
  }),
  findProformaArtifact: (organizationId, proformaId) => attempt("find proforma artifact", () => {
    const database = new DatabaseSync(documentsDatabasePath(dataDirectory), { readOnly: true })
    try {
      const value = artifactRow(database.prepare(
        "SELECT * FROM proforma_artifacts WHERE organization_id = ? AND proforma_id = ?",
      ).get(organizationId, proformaId))
      return value === undefined ? undefined : proformaArtifactFrom(value)
    } finally { database.close() }
  }),
  saveProformaArtifact: (artifact) => Effect.try({
    try: () => {
      const database = new DatabaseSync(documentsDatabasePath(dataDirectory))
      let open = false
      try {
        database.exec("BEGIN IMMEDIATE")
        open = true
        const value = artifactRow(database.prepare("SELECT * FROM proforma_artifacts WHERE proforma_id = ?").get(artifact.proformaId))
        if (value !== undefined) {
          const existing = proformaArtifactFrom(value)
          if (!sameProformaArtifact(existing, artifact)) throw new ArtifactConflict({ documentKind: "proforma", documentId: artifact.proformaId })
          database.exec("ROLLBACK")
          open = false
          return existing
        }
        database.prepare(`INSERT INTO proforma_artifacts
          (proforma_id, organization_id, object_key, sha256, byte_length, media_type, template_version, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(artifact.proformaId, artifact.organizationId, artifact.objectKey,
          artifact.sha256, artifact.byteLength, artifact.mediaType, artifact.templateVersion, artifact.generatedAt)
        database.exec("COMMIT")
        open = false
        return artifact
      } finally {
        if (open) database.exec("ROLLBACK")
        database.close()
      }
    },
    catch: (error) => error instanceof ArtifactConflict ? error : failure("save proforma artifact"),
  }),
})
