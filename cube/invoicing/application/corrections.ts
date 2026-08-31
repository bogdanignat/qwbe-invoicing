import { Effect } from "effect"
import { DomainConflict, PermissionDenied, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { invoicingPermissions } from "../contracts/permissions.ts"
import { negateMoney, validateCreateCorrectionInput, type CorrectionDocument, type CreateCorrectionInput } from "../domain/corrections.ts"
import { missing } from "./drafting.ts"
import type { InvoicingTransaction } from "./ports.ts"
export interface CorrectionDependencies { readonly context: RequestContextProvider; readonly clock: Clock; readonly ids: IdGenerator; readonly store: TransactionalStore<InvoicingTransaction>; readonly cubeIdentity: string }
const fy = (d: string): number => Number(d.slice(0, 4))
export const createCorrectionOperations = (d: CorrectionDependencies) => {
  const perms = invoicingPermissions(d.cubeIdentity)
  const auth = (p: string): Effect.Effect<RequestContext, InvoicingFailure> => Effect.flatMap(d.context.current, (c) => c.identity.permissions.includes(p) ? Effect.succeed(c) : Effect.fail(new PermissionDenied({ permission: p })))
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
      const number = yield* tx.allocateCorrectionNumber(ctx.organization.id, fy(issueDate), orig.series)
      const issuedAt = now.toISOString()
      const negLines = orig.lines.map((l) => ({ ...l, totalExcludingTax: negateMoney(l.totalExcludingTax), taxAmount: negateMoney(l.taxAmount), totalIncludingTax: negateMoney(l.totalIncludingTax) }))
      const negBreakdown = orig.taxBreakdown.map((t) => ({ ...t, taxableAmount: negateMoney(t.taxableAmount), taxAmount: negateMoney(t.taxAmount) }))
      const corr: CorrectionDocument = {
        id, organizationId: ctx.organization.id, originalInvoiceId: orig.id, fiscalYear: fy(issueDate), series: orig.series, number, issueDate, issuedAt, reason: input.reason.trim(), currency: orig.currency,
        issuer: { legalName: orig.issuer.legalName, taxIdentifier: orig.issuer.taxIdentifier, address: { ...orig.issuer.address } },
        customer: { legalName: orig.customer.legalName, taxIdentifier: orig.customer.taxIdentifier, address: { ...orig.customer.address } },
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
