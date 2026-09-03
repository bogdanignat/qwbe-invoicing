import { Effect } from "effect"
import { DomainConflict, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { negateMoney, validateCreateCorrectionInput, type CorrectionDocument, type CreateCorrectionInput } from "../domain/corrections.ts"
import { copyBuyer, copyParty, missing } from "./support.ts"
import type { InvoicingTransaction } from "./ports.ts"
type CorrectionDependencies = { readonly clock: Clock; readonly ids: IdGenerator; readonly store: TransactionalStore<InvoicingTransaction> }
const fy = (d: string): number => Number(d.slice(0, 4))
type Authorize = (permission: string) => Effect.Effect<RequestContext, InvoicingFailure>
export const createCorrectionOperations = (d: CorrectionDependencies, perms: InvoicingPermissions, auth: Authorize) => {
  const createCorrection = (input: CreateCorrectionInput): Effect.Effect<CorrectionDocument, InvoicingFailure> => Effect.gen(function*() {
    validateCreateCorrectionInput(input)
    const ctx = yield* auth(perms.voidInvoices)
    const id = yield* d.ids.next
    const now = yield* d.clock.now
    const issueDate = input.issueDate ?? now.toISOString().slice(0, 10)
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const orig = yield* tx.findIssuedInvoice(ctx.organization.id, input.originalInvoiceId)
      if (orig === undefined) return yield* Effect.fail(missing("invoice", input.originalInvoiceId))
      const existing = yield* tx.listCorrections(ctx.organization.id, input.originalInvoiceId)
      if (existing.length > 0) {
        return yield* Effect.fail(new DomainConflict({
          code: "invoice_already_corrected",
          message: "An invoice can have only one full correction document",
        }))
      }
      const number = yield* tx.allocateDocumentNumber(ctx.organization.id, fy(issueDate), "correction", orig.series)
      const issuedAt = now.toISOString()
      const negLines = orig.lines.map((l) => ({ ...l, totalExcludingTax: negateMoney(l.totalExcludingTax), taxAmount: negateMoney(l.taxAmount), totalIncludingTax: negateMoney(l.totalIncludingTax) }))
      const negBreakdown = orig.taxBreakdown.map((t) => ({ ...t, taxableAmount: negateMoney(t.taxableAmount), taxAmount: negateMoney(t.taxAmount) }))
      const corr: CorrectionDocument = {
        id, organizationId: ctx.organization.id, originalInvoiceId: orig.id, fiscalYear: fy(issueDate), series: orig.series, number, issueDate, issuedAt, reason: input.reason.trim(), currency: orig.currency,
        issuer: copyParty(orig.issuer), customer: copyBuyer(orig.customer),
        lines: negLines, taxBreakdown: negBreakdown,
        totalExcludingTax: negateMoney(orig.totalExcludingTax), taxTotal: negateMoney(orig.taxTotal), totalIncludingTax: negateMoney(orig.totalIncludingTax),
      }
      yield* tx.saveCorrection(corr)
      return corr
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
  const listCorrections = (originalInvoiceId: string): Effect.Effect<ReadonlyArray<CorrectionDocument>, InvoicingFailure> => Effect.gen(function*() {
    const ctx = yield* auth(perms.read)
    return yield* d.store.transaction((tx) => tx.listCorrections(ctx.organization.id, originalInvoiceId))
  })
  return { createCorrection, getCorrection, listCorrections }
}
export type CorrectionOperations = ReturnType<typeof createCorrectionOperations>
