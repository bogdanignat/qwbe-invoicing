import { DatabaseSync } from "node:sqlite"

import { Effect } from "effect"

import {
  ArtifactConflict,
  DocumentPersistenceFailure,
  type ArtifactRepository,
  type InvoiceArtifact,
  type InvoiceSource,
  type RenderableInvoice,
} from "../cube/invoicing/documents/index.ts"
import { databasePath, documentsDatabasePath } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

type Row = Readonly<Record<string, unknown>>

const failure = (operation: string) => new DocumentPersistenceFailure({ operation })

const attempt = <Value>(operation: string, run: () => Value) => Effect.try({
  try: run,
  catch: () => failure(operation),
})

const row = (value: unknown): Row | undefined =>
  typeof value === "object" && value !== null ? value as Row : undefined

const text = (value: Row, field: string): string => {
  const result = value[field]
  if (typeof result !== "string") throw new Error(`invalid ${field}`)
  return result
}

const integer = (value: Row, field: string): number => {
  const result = value[field]
  if (typeof result !== "number" || !Number.isInteger(result)) throw new Error(`invalid ${field}`)
  return result
}

const artifactFrom = (value: Row): InvoiceArtifact => ({
  invoiceId: text(value, "invoice_id"),
  organizationId: text(value, "organization_id"),
  objectKey: text(value, "object_key"),
  sha256: text(value, "sha256"),
  byteLength: integer(value, "byte_length"),
  mediaType: "application/pdf",
  templateVersion: text(value, "template_version"),
  generatedAt: text(value, "generated_at"),
})

const sameArtifact = (left: InvoiceArtifact, right: InvoiceArtifact): boolean =>
  left.invoiceId === right.invoiceId
  && left.organizationId === right.organizationId
  && left.objectKey === right.objectKey
  && left.sha256 === right.sha256
  && left.byteLength === right.byteLength
  && left.templateVersion === right.templateVersion

export const createArtifactRepository = (dataDirectory: string): ArtifactRepository => ({
  findArtifact: (organizationId, invoiceId) => attempt("find artifact", () => {
    const database = new DatabaseSync(documentsDatabasePath(dataDirectory), { readOnly: true })
    try {
      const value = row(database.prepare(
        "SELECT * FROM invoice_artifacts WHERE organization_id = ? AND invoice_id = ?",
      ).get(organizationId, invoiceId))
      return value === undefined ? undefined : artifactFrom(value)
    } finally {
      database.close()
    }
  }),
  saveArtifact: (artifact) => Effect.try({
    try: () => {
      const database = new DatabaseSync(documentsDatabasePath(dataDirectory))
      let open = false
      try {
        database.exec("BEGIN IMMEDIATE")
        open = true
        const value = row(database.prepare("SELECT * FROM invoice_artifacts WHERE invoice_id = ?")
          .get(artifact.invoiceId))
        if (value !== undefined) {
          const existing = artifactFrom(value)
          if (!sameArtifact(existing, artifact)) throw new ArtifactConflict({ invoiceId: artifact.invoiceId })
          database.exec("ROLLBACK")
          open = false
          return existing
        }
        database.prepare(`INSERT INTO invoice_artifacts
          (invoice_id, organization_id, object_key, sha256, byte_length, media_type, template_version, generated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(artifact.invoiceId, artifact.organizationId, artifact.objectKey, artifact.sha256,
            artifact.byteLength, artifact.mediaType, artifact.templateVersion, artifact.generatedAt)
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
})

export const createInvoiceSource = (dataDirectory: string): InvoiceSource => {
  const store = createSqliteStore(dataDirectory)
  return {
    findInvoice: (organizationId, invoiceId) => store.transaction((transaction) =>
      transaction.findIssuedInvoice(organizationId, invoiceId)).pipe(
        Effect.map((invoice): RenderableInvoice | undefined => invoice),
        Effect.mapError(() => failure("find source invoice")),
      ),
    listIssuedInvoiceIds: (organizationId) => attempt("list issued invoices", () => {
      const database = new DatabaseSync(databasePath(dataDirectory), { readOnly: true })
      try {
        return database.prepare(
          "SELECT id FROM issued_invoices WHERE organization_id = ? ORDER BY issued_at, id",
        ).all(organizationId).map((value) => text(value as Row, "id"))
      } finally {
        database.close()
      }
    }),
  }
}
