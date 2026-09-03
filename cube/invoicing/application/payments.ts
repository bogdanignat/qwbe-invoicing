import { Effect } from "effect"
import { ValidationFailure, type InvoicingFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, TransactionalStore } from "../contracts/host.ts"
import type { InvoicingPermissions } from "../contracts/permissions.ts"
import { derivePaymentStatus, formatMinor, moneyMinor, sumPaymentsMinor, validateRecordPaymentInput, type Payment, type PaymentStatus, type RecordPaymentInput } from "../domain/payments.ts"
import { missing } from "./support.ts"
import type { InvoicingTransaction } from "./ports.ts"
import type { IssuedInvoice } from "../domain/invoice.ts"
type PaymentDependencies = { readonly clock: Clock; readonly ids: IdGenerator; readonly store: TransactionalStore<InvoicingTransaction> }
type PaymentAmounts = { readonly status: PaymentStatus; readonly paidAmount: string; readonly remainingAmount: string }
export type RecordPaymentResult = PaymentAmounts & { readonly payment: Payment }
export type InvoicePaymentSummary = PaymentAmounts & { readonly invoiceId: string; readonly payments: ReadonlyArray<Payment> }
const summarize = (invoice: IssuedInvoice, payments: ReadonlyArray<Payment>, now: Date) => {
  const paid = sumPaymentsMinor(payments)
  const remaining = moneyMinor(invoice.totalIncludingTax) - paid
  return {
    status: derivePaymentStatus({ totalIncludingTax: invoice.totalIncludingTax, dueDate: invoice.dueDate, payments, now }),
    paidAmount: formatMinor(paid), remainingAmount: formatMinor(remaining < 0n ? 0n : remaining),
  }
}
type Authorize = (permission: string) => Effect.Effect<RequestContext, InvoicingFailure>
export const createPaymentOperations = (d: PaymentDependencies, p: InvoicingPermissions, auth: Authorize) => {
  const recordPayment = (input: RecordPaymentInput): Effect.Effect<RecordPaymentResult, InvoicingFailure> => Effect.gen(function*() {
    validateRecordPaymentInput(input); const ctx = yield* auth(p.recordPayments); const pid = yield* d.ids.next; const now = yield* d.clock.now
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const inv = yield* tx.findIssuedInvoice(ctx.organization.id, input.invoiceId); if (inv === undefined) return yield* Effect.fail(missing("invoice", input.invoiceId))
      if (inv.currency !== input.currency) return yield* Effect.fail(new ValidationFailure({ issues: ["payment currency must match invoice currency"] }))
      const existing = yield* tx.listPayments(ctx.organization.id, input.invoiceId)
      const pay: Payment = { id: pid, invoiceId: input.invoiceId, organizationId: ctx.organization.id, amount: formatMinor(moneyMinor(input.amount)), currency: input.currency, paymentDate: input.paymentDate, method: input.method.trim(), ...(input.externalReference === undefined ? {} : { externalReference: input.externalReference.trim() }), ...(input.note === undefined ? {} : { note: input.note.trim() }), actorId: ctx.identity.id, createdAt: now.toISOString() }
      yield* tx.savePayment(pay)
      return { payment: pay, ...summarize(inv, [...existing, pay], now) }
    }))
  })
  const listPayments = (invoiceId: string): Effect.Effect<InvoicePaymentSummary, InvoicingFailure> => Effect.gen(function*() {
    const ctx = yield* auth(p.read); const now = yield* d.clock.now
    return yield* d.store.transaction((tx) => Effect.gen(function*() {
      const inv = yield* tx.findIssuedInvoice(ctx.organization.id, invoiceId); if (inv === undefined) return yield* Effect.fail(missing("invoice", invoiceId))
      const pays = yield* tx.listPayments(ctx.organization.id, invoiceId)
      return { invoiceId, ...summarize(inv, pays, now), payments: pays }
    }))
  })
  return { recordPayment, listPayments }
}
export type PaymentOperations = ReturnType<typeof createPaymentOperations>
