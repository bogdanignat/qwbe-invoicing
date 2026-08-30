import { Effect } from "effect"
import { PermissionDenied, ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { invoicingPermissions } from "../contracts/permissions.ts"
import { derivePaymentStatus, formatMinor, sumPaymentsMinor, validateRecordPaymentInput, type Payment, type PaymentStatus, type RecordPaymentInput } from "../domain/payments.ts"
import { missing } from "./drafting.ts"
import type { InvoicingTransaction } from "./ports.ts"
export interface PaymentDependencies { readonly context: RequestContextProvider; readonly clock: Clock; readonly ids: IdGenerator; readonly store: TransactionalStore<InvoicingTransaction>; readonly cubeIdentity: string }
export interface RecordPaymentResult { readonly payment: Payment; readonly status: PaymentStatus; readonly paidAmount: string; readonly remainingAmount: string }
export interface InvoicePaymentSummary { readonly invoiceId: string; readonly status: PaymentStatus; readonly paidAmount: string; readonly remainingAmount: string; readonly payments: ReadonlyArray<Payment> }
const toMinor = (v: string): bigint => { const m = /^(\d+)\.(\d{2})$/.exec(v.trim()); if (m !== null) return BigInt(m[1] ?? "0") * 100n + BigInt(m[2] ?? "0"); const p = v.trim().split("."); return BigInt(p[0] ?? "0") * 100n + BigInt((p[1] ?? "").padEnd(2, "0").slice(0, 2) || "0") }
export const createPaymentOperations = (d: PaymentDependencies) => {
  const p = invoicingPermissions(d.cubeIdentity)
  const auth = (perm: string): Effect.Effect<RequestContext, InvoicingFailure> => Effect.flatMap(d.context.current, (c) => c.identity.permissions.includes(perm) ? Effect.succeed(c) : Effect.fail(new PermissionDenied({ permission: perm })))
  const recordPayment = (input: RecordPaymentInput): Effect.Effect<RecordPaymentResult, InvoicingFailure> => Effect.gen(function*() {
    validateRecordPaymentInput(input); const ctx = yield* auth(p.recordPayments); const pid = yield* d.ids.next; const now = yield* d.clock.now
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const inv = yield* tx.findIssuedInvoice(ctx.organization.id, input.invoiceId); if (inv === undefined) return yield* Effect.fail(missing("invoice", input.invoiceId))
      if (inv.currency !== input.currency) return yield* Effect.fail(new ValidationFailure({ issues: ["payment currency must match invoice currency"] }))
      const existing = yield* tx.listPayments(ctx.organization.id, input.invoiceId)
      const pay: Payment = { id: pid, invoiceId: input.invoiceId, organizationId: ctx.organization.id, amount: formatMinor(toMinor(input.amount)), currency: input.currency, paymentDate: input.paymentDate, method: input.method.trim(), ...(input.externalReference === undefined ? {} : { externalReference: input.externalReference.trim() }), ...(input.note === undefined ? {} : { note: input.note.trim() }), actorId: ctx.identity.id, createdAt: now.toISOString() }
      yield* tx.savePayment(pay); const upd = [...existing, pay]
      const status = derivePaymentStatus({ totalIncludingTax: inv.totalIncludingTax, dueDate: inv.dueDate, payments: upd, now })
      const paid = sumPaymentsMinor(upd); const total = toMinor(inv.totalIncludingTax); const rem = total - paid
      return { payment: pay, status, paidAmount: formatMinor(paid < 0n ? 0n : paid), remainingAmount: formatMinor(rem < 0n ? 0n : rem) }
    }))
  })
  const listPayments = (invoiceId: string): Effect.Effect<InvoicePaymentSummary, InvoicingFailure> => Effect.gen(function*() {
    const ctx = yield* auth(p.read); const now = yield* d.clock.now
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const inv = yield* tx.findIssuedInvoice(ctx.organization.id, invoiceId); if (inv === undefined) return yield* Effect.fail(missing("invoice", invoiceId))
      const pays = yield* tx.listPayments(ctx.organization.id, invoiceId)
      const status = derivePaymentStatus({ totalIncludingTax: inv.totalIncludingTax, dueDate: inv.dueDate, payments: pays, now })
      const paid = sumPaymentsMinor(pays); const total = toMinor(inv.totalIncludingTax); const rem = total - paid
      return { invoiceId, status, paidAmount: formatMinor(paid), remainingAmount: formatMinor(rem < 0n ? 0n : rem), payments: pays }
    }))
  })
  const getInvoiceWithPayments = (invoiceId: string) => Effect.gen(function*() {
    const ctx = yield* auth(p.read); const now = yield* d.clock.now
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const inv = yield* tx.findIssuedInvoice(ctx.organization.id, invoiceId); if (inv === undefined) return yield* Effect.fail(missing("invoice", invoiceId))
      const pays = yield* tx.listPayments(ctx.organization.id, invoiceId)
      const status = derivePaymentStatus({ totalIncludingTax: inv.totalIncludingTax, dueDate: inv.dueDate, payments: pays, now })
      const paid = sumPaymentsMinor(pays); const total = toMinor(inv.totalIncludingTax)
      return { invoice: inv, payments: pays, status, paidAmount: formatMinor(paid), remainingAmount: formatMinor(total - paid < 0n ? 0n : total - paid) }
    }))
  })
  return { recordPayment, listPayments, getInvoiceWithPayments }
}
export type PaymentOperations = ReturnType<typeof createPaymentOperations>
