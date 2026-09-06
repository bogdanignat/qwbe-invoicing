import { Effect } from "effect"

import { PermissionDenied, ResourceNotFound, type PaymentsFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { derivePaymentStatus, formatMinor, moneyMinor, sumPaymentsMinor, type Payment, type PaymentStatus } from "../domain/payments.ts"
import type { AuditEvent, InvoiceSnapshot, PaymentsTransaction } from "./ports.ts"

export interface PaymentsDependencies {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<PaymentsTransaction>
  readonly cubeIdentity: string
}
export type PaymentAmounts = { readonly status: PaymentStatus; readonly paidAmount: string; readonly remainingAmount: string }
export type RecordPaymentResult = PaymentAmounts & { readonly payment: Payment }
export type InvoicePaymentSummary = PaymentAmounts & { readonly invoiceId: string; readonly payments: ReadonlyArray<Payment> }

export type Authorize = (permission: string) => Effect.Effect<RequestContext, PaymentsFailure>

export const createAuthorize = (dependencies: PaymentsDependencies): Authorize => (permission) =>
  Effect.flatMap(dependencies.context.current, (context) =>
    context.identity.permissions.includes(permission)
      ? Effect.succeed(context)
      : Effect.fail(new PermissionDenied({ permission })))

export const summarize = (invoice: InvoiceSnapshot, payments: ReadonlyArray<Payment>, now: Date): PaymentAmounts => {
  const paid = sumPaymentsMinor(payments); const remaining = moneyMinor(invoice.totalIncludingVat) - paid
  return {
    status: derivePaymentStatus({ totalIncludingVat: invoice.totalIncludingVat, dueDate: invoice.dueDate, payments, now }),
    paidAmount: formatMinor(paid < 0n ? 0n : paid), remainingAmount: formatMinor(remaining < 0n ? 0n : remaining),
  }
}
export const audit = (
  transaction: PaymentsTransaction, context: RequestContext, dependencies: PaymentsDependencies, occurredAt: Date,
  event: Pick<AuditEvent, "action" | "targetKind" | "targetId" | "reason">,
) => Effect.flatMap(dependencies.ids.next, (id) => transaction.appendAuditEvent({
  id, organizationId: context.organization.id, actorId: context.identity.id, occurredAt: occurredAt.toISOString(), ...event,
}))
export const missingInvoice = (id: string) => new ResourceNotFound({ resource: "invoice", id })
export const missingPayment = (id: string) => new ResourceNotFound({ resource: "payment", id })

// Replays answer with the same result the first request produced, recomputed against today's balance.
export const replayed = (transaction: PaymentsTransaction, context: RequestContext, invoice: InvoiceSnapshot, paymentId: string, now: Date) => Effect.gen(function*() {
  const payment = yield* transaction.findPayment(context.organization.id, invoice.id, paymentId)
  if (payment === undefined) return yield* Effect.fail(missingPayment(paymentId))
  const payments = yield* transaction.listPayments(context.organization.id, invoice.id)
  return { payment, ...summarize(invoice, payments, now) } satisfies RecordPaymentResult
})
