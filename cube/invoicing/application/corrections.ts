import { Effect } from "effect"
import { DomainConflict, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { negateMoney, validateCreateCorrectionInput, type CorrectionDocument, type CreateCorrectionInput } from "../domain/corrections.ts"
import type { DocumentSource, Idempotent } from "../domain/invoice.ts"
import { validateDocumentSource } from "../domain/validation.ts"
import { findIdempotencyReplay, idempotencyRecord, missingIdempotencyResult } from "./idempotency.ts"
import { checked, copyBuyer, copyParty, copySource, missing } from "./support.ts"
import type { InvoicingTransaction } from "./ports.ts"
type CorrectionDependencies = { readonly clock: Clock; readonly ids: IdGenerator; readonly store: TransactionalStore<InvoicingTransaction> }
const fy = (d: string): number => Number(d.slice(0, 4))
type Authorize = (permission: string) => Effect.Effect<RequestContext, InvoicingFailure>
export const createCorrectionOperations = (d: CorrectionDependencies, perms: InvoicingPermissions, auth: Authorize) => {
  const createCorrection = ({ request: input, idempotency }: Idempotent<CreateCorrectionInput>): Effect.Effect<CorrectionDocument, InvoicingFailure> => Effect.gen(function*() {
    yield* checked(() => {
      validateCreateCorrectionInput(input)
      if (input.source !== undefined) validateDocumentSource(input.source)
    })
    const ctx = yield* auth(perms.voidInvoices)
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const operation = "create_correction"
      const replayId = yield* findIdempotencyReplay(tx, ctx.organization.id, idempotency, operation, "correction")
      if (replayId !== undefined) {
        const replay = yield* tx.findCorrection(ctx.organization.id, replayId)
        return replay === undefined ? yield* Effect.fail(missingIdempotencyResult("correction")) : structuredClone(replay)
      }
      const orig = yield* tx.findIssuedInvoice(ctx.organization.id, input.originalInvoiceId)
      if (orig === undefined) return yield* Effect.fail(missing("invoice", input.originalInvoiceId))
      const existing = yield* tx.listCorrections(ctx.organization.id, input.originalInvoiceId)
      if (existing.length > 0) {
        return yield* Effect.fail(new DomainConflict({
          code: "invoice_already_corrected",
          message: "An invoice can have only one full correction document",
        }))
      }
      const id = yield* d.ids.next
      const now = yield* d.clock.now
      const issueDate = input.issueDate ?? now.toISOString().slice(0, 10)
      const number = yield* tx.allocateDocumentNumber(ctx.organization.id, fy(issueDate), "correction", orig.series)
      const issuedAt = now.toISOString()
      const source = input.source ?? orig.source
      const negLines = orig.lines.map((l) => ({ ...l, totalExcludingVat: negateMoney(l.totalExcludingVat), vatAmount: negateMoney(l.vatAmount), totalIncludingVat: negateMoney(l.totalIncludingVat) }))
      const negBreakdown = orig.vatBreakdown.map((t) => ({ ...t, vatBaseAmount: negateMoney(t.vatBaseAmount), vatAmount: negateMoney(t.vatAmount) }))
      const corr: CorrectionDocument = {
        id, organizationId: ctx.organization.id, originalInvoiceId: orig.id, fiscalYear: fy(issueDate), series: orig.series, number, issueDate, issuedAt, reason: input.reason.trim(), currency: orig.currency,
        ...(source === undefined ? {} : { source: copySource(source) }),
        issuer: copyParty(orig.issuer), customer: copyBuyer(orig.customer),
        lines: negLines, vatBreakdown: negBreakdown,
        totalExcludingVat: negateMoney(orig.totalExcludingVat), vatTotal: negateMoney(orig.vatTotal), totalIncludingVat: negateMoney(orig.totalIncludingVat),
      }
      yield* tx.saveCorrection(corr)
      yield* tx.saveIdempotencyRecord(idempotencyRecord(
        ctx.organization.id, idempotency, operation, "correction", corr.id, issuedAt,
      ))
      return structuredClone(corr)
    }))
  })
  const getCorrection = (id: string): Effect.Effect<CorrectionDocument, InvoicingFailure> => Effect.gen(function*() {
    const ctx = yield* auth(perms.read)
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const c = yield* tx.findCorrection(ctx.organization.id, id)
      if (c === undefined) return yield* Effect.fail(missing("correction", id))
      return c
    }))
  })
  const listCorrections = (originalInvoiceId: string, source?: DocumentSource): Effect.Effect<ReadonlyArray<CorrectionDocument>, InvoicingFailure> => Effect.gen(function*() {
    if (source !== undefined) yield* checked(() => { validateDocumentSource(source) })
    const ctx = yield* auth(perms.read)
    return yield* d.store.transaction((tx) => tx.listCorrections(ctx.organization.id, originalInvoiceId, source))
  })
  return { createCorrection, getCorrection, listCorrections }
}
export type CorrectionOperations = ReturnType<typeof createCorrectionOperations>
