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
  const invoiceIds = await Effect.runPromise(service.listMissingInvoiceIds())
  if (!apply) {
    return { scanned: invoiceIds.length, changed: 0, skipped: invoiceIds.length, failed: 0, pending: invoiceIds.length }
  }
  let changed = 0
  let failed = 0
  for (const invoiceId of invoiceIds.slice(0, limit)) {
    const result = await Effect.runPromise(Effect.either(service.renderInvoice(invoiceId)))
    if (Either.isLeft(result)) failed += 1
    else changed += 1
  }
  return {
    scanned: invoiceIds.length,
    changed,
    skipped: Math.max(0, invoiceIds.length - limit),
    failed,
    pending: invoiceIds.length - changed,
  }
}
