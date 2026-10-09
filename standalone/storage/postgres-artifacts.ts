import { Effect } from "effect"
import type { Pool } from "pg"

import {
  DocumentPersistenceFailure, type InvoiceSource, type RenderableCorrection, type RenderableInvoice, type RenderableProforma,
} from "../../cube/invoicing/documents/index.ts"
import { artifactText } from "./postgres-artifact-rows.ts"
import { createPostgresArtifactRepository } from "./postgres-artifact-repository.ts"
import { businessTransaction, createPostgresStore } from "./postgres-store.ts"

export { createPostgresArtifactRepository }

/**
 * The documents cube's read side over the business tables.
 *
 * The two id listings go through a business transaction rather than a bare
 * query: SQLite opened a second read-only connection for them, PostgreSQL has
 * one pool, and a listing taken outside the maintenance barrier could see a
 * half-applied migration. The lock is the one every business read takes.
 */

const failure = (operation: string) => new DocumentPersistenceFailure({ operation })

export const createPostgresInvoiceSource = (pool: Pool): InvoiceSource => {
  const store = createPostgresStore(pool)
  const listIds = (operation: string, sql: string, organizationId: string) =>
    businessTransaction(pool)((client) => Effect.tryPromise({
      try: async () => {
        const { rows } = await client.query(sql, [organizationId])
        return rows.map((value) => artifactText(value, "id"))
      },
      catch: () => failure(operation),
    })).pipe(Effect.mapError(() => failure(operation)))
  return {
    findInvoice: (organizationId, invoiceId) => store.transaction((transaction) =>
      transaction.findIssuedInvoice(organizationId, invoiceId)).pipe(
      Effect.map((invoice): RenderableInvoice | undefined => invoice),
      Effect.mapError(() => failure("find source invoice")),
    ),
    listIssuedInvoiceIds: (organizationId) => listIds(
      "list issued invoices",
      "SELECT id FROM issued_invoices WHERE organization_id = $1 ORDER BY issued_at, id",
      organizationId,
    ),
    findProforma: (organizationId, proformaId) => store.transaction((transaction) =>
      transaction.findProforma(organizationId, proformaId)).pipe(
      Effect.map((proforma): RenderableProforma | undefined => proforma),
      Effect.mapError(() => failure("find source proforma")),
    ),
    listProformaIds: (organizationId) => listIds(
      "list proformas",
      "SELECT id FROM proformas WHERE organization_id = $1 AND sealed = 1 ORDER BY issued_at, id",
      organizationId,
    ),
    // The correction snapshot carries no branding; the original invoice's is the one the buyer already received.
    findCorrection: (organizationId, correctionId) => store.transaction((transaction) => Effect.gen(function*() {
      const correction = yield* transaction.findCorrection(organizationId, correctionId)
      if (correction === undefined) return undefined
      const original = yield* transaction.findIssuedInvoice(organizationId, correction.originalInvoiceId)
      if (original === undefined) return undefined
      const renderable: RenderableCorrection = {
        id: correction.id, organizationId: correction.organizationId, series: correction.series, number: correction.number,
        issueDate: correction.issueDate, dueDate: null, issuedAt: correction.issuedAt, currency: correction.currency,
        notes: null, issuer: { ...correction.issuer, branding: original.issuer.branding }, customer: correction.customer,
        lines: correction.lines, vatBreakdown: correction.vatBreakdown, totalExcludingVat: correction.totalExcludingVat,
        vatTotal: correction.vatTotal, totalIncludingVat: correction.totalIncludingVat, reason: correction.reason,
        original: { series: original.series, number: original.number, issueDate: original.issueDate },
      }
      return renderable
    })).pipe(Effect.mapError(() => failure("find source correction"))),
  }
}
