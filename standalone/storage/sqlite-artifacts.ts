import { DatabaseSync } from "node:sqlite"

import { Effect } from "effect"

import {
  DocumentPersistenceFailure, type InvoiceSource, type RenderableInvoice, type RenderableProforma,
} from "../../cube/invoicing/documents/index.ts"
import { databasePath } from "./migrations.ts"
import { artifactText, type ArtifactRow } from "./sqlite-artifact-rows.ts"
import { createArtifactRepository } from "./sqlite-artifact-repository.ts"
import { createSqliteStore } from "./sqlite-store.ts"

export { createArtifactRepository }

const failure = (operation: string) => new DocumentPersistenceFailure({ operation })
const attempt = <Value>(operation: string, run: () => Value) => Effect.try({ try: run, catch: () => failure(operation) })

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
        return database.prepare("SELECT id FROM issued_invoices WHERE organization_id = ? ORDER BY issued_at, id")
          .all(organizationId).map((value) => artifactText(value as ArtifactRow, "id"))
      } finally { database.close() }
    }),
    findProforma: (organizationId, proformaId) => store.transaction((transaction) =>
      transaction.findProforma(organizationId, proformaId)).pipe(
        Effect.map((proforma): RenderableProforma | undefined => proforma),
        Effect.mapError(() => failure("find source proforma")),
      ),
    listProformaIds: (organizationId) => attempt("list proformas", () => {
      const database = new DatabaseSync(databasePath(dataDirectory), { readOnly: true })
      try {
        return database.prepare("SELECT id FROM proformas WHERE organization_id = ? AND sealed = 1 ORDER BY issued_at, id")
          .all(organizationId).map((value) => artifactText(value as ArtifactRow, "id"))
      } finally { database.close() }
    }),
  }
}
