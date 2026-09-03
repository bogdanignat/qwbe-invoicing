import { Effect, Either } from "effect"

import type { ArtifactService } from "../cube/invoicing/documents/index.ts"

export interface ArtifactReconciliationReport {
  readonly scanned: number
  readonly changed: number
  readonly skipped: number
  readonly failed: number
  readonly pending: number
}

export const reconcileArtifacts = async (
  service: ArtifactService,
  limit: number,
  apply: boolean,
): Promise<ArtifactReconciliationReport> => {
  const [invoiceIds, proformaIds] = await Promise.all([
    Effect.runPromise(service.listMissingInvoiceIds()),
    Effect.runPromise(service.listMissingProformaIds()),
  ])
  const documents = [
    ...invoiceIds.map((id) => ({ kind: "invoice" as const, id })),
    ...proformaIds.map((id) => ({ kind: "proforma" as const, id })),
  ]
  if (!apply) {
    return { scanned: documents.length, changed: 0, skipped: documents.length, failed: 0, pending: documents.length }
  }
  let changed = 0
  let failed = 0
  for (const document of documents.slice(0, limit)) {
    const render: Effect.Effect<unknown, import("../cube/invoicing/documents/index.ts").DocumentsFailure> =
      document.kind === "invoice" ? service.renderInvoice(document.id) : service.renderProforma(document.id)
    const result = await Effect.runPromise(Effect.either(render))
    if (Either.isLeft(result)) failed += 1
    else changed += 1
  }
  return {
    scanned: documents.length,
    changed,
    skipped: Math.max(0, documents.length - limit),
    failed,
    pending: documents.length - changed,
  }
}
