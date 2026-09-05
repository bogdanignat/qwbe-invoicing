import { Effect } from "effect"

import { DomainConflict, PermissionDenied, ResourceNotFound, ValidationFailure, type PaymentsFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContext, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { legacyPaymentsPermissions, paymentsPermissions } from "../contracts/permissions.ts"
import { calendarDate, derivePaymentStatus, formatMinor, moneyMinor, sumPaymentsMinor, validateRecordPaymentInput, validateReversePaymentInput, type Idempotent, type Payment, type PaymentStatus, type RecordPaymentInput, type ReversePaymentInput } from "../domain/payments.ts"
import { findReplay, idempotencyRecord, validateAttempt } from "./idempotency.ts"
import type { InvoiceSnapshot, PaymentsTransaction } from "./ports.ts"

export interface PaymentsDependencies {
  readonly context: RequestContextProvider
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<PaymentsTransaction>
  readonly cubeIdentity: string
}
type PaymentAmounts = { readonly status: PaymentStatus; readonly paidAmount: string; readonly remainingAmount: string }
export type RecordPaymentResult = PaymentAmounts & { readonly payment: Payment }
export type InvoicePaymentSummary = PaymentAmounts & { readonly invoiceId: string; readonly payments: ReadonlyArray<Payment> }
const summarize = (invoice: InvoiceSnapshot, payments: ReadonlyArray<Payment>, now: Date): PaymentAmounts => {
  const paid = sumPaymentsMinor(payments); const remaining = moneyMinor(invoice.totalIncludingVat) - paid
  return {
    status: derivePaymentStatus({ totalIncludingVat: invoice.totalIncludingVat, dueDate: invoice.dueDate, payments, now }),
    paidAmount: formatMinor(paid < 0n ? 0n : paid), remainingAmount: formatMinor(remaining < 0n ? 0n : remaining),
  }
}
const missingInvoice = (id: string) => new ResourceNotFound({ resource: "invoice", id })
const missingPayment = (id: string) => new ResourceNotFound({ resource: "payment", id })

export const createPaymentsService = (dependencies: PaymentsDependencies) => {
  const permissions = paymentsPermissions(dependencies.cubeIdentity)
  const authorized = (permission: string, legacyPermission: string): Effect.Effect<RequestContext, PaymentsFailure> =>
    Effect.flatMap(dependencies.context.current, (context) =>
      context.identity.permissions.includes(permission) || context.identity.permissions.includes(legacyPermission)
        ? Effect.succeed(context)
        : Effect.fail(new PermissionDenied({ permission })))
  // Replays answer with the same result the first request produced, recomputed against today's balance.
  const replayed = (transaction: PaymentsTransaction, context: RequestContext, invoice: InvoiceSnapshot, paymentId: string, now: Date) => Effect.gen(function*() {
    const payment = yield* transaction.findPayment(context.organization.id, invoice.id, paymentId)
    if (payment === undefined) return yield* Effect.fail(missingPayment(paymentId))
    const payments = yield* transaction.listPayments(context.organization.id, invoice.id)
    return { payment, ...summarize(invoice, payments, now) } satisfies RecordPaymentResult
  })
  const recordPayment = ({ request: input, idempotency }: Idempotent<RecordPaymentInput>): Effect.Effect<RecordPaymentResult, PaymentsFailure> => Effect.gen(function*() {
    validateRecordPaymentInput(input)
    yield* validateAttempt(idempotency)
    const context = yield* authorized(permissions.record, legacyPaymentsPermissions.record); const id = yield* dependencies.ids.next; const now = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const invoice = yield* transaction.findInvoiceSnapshot(context.organization.id, input.invoiceId)
      if (invoice === undefined) return yield* Effect.fail(missingInvoice(input.invoiceId))
      const replayId = yield* findReplay(transaction, context.organization.id, idempotency, "record_payment")
      if (replayId !== undefined) return yield* replayed(transaction, context, invoice, replayId, now)
      if (invoice.currency !== input.currency) return yield* Effect.fail(new ValidationFailure({ issues: ["payment currency must match invoice currency"] }))
      const existing = yield* transaction.listPayments(context.organization.id, input.invoiceId)
      const payment: Payment = {
        id, invoiceId: input.invoiceId, organizationId: context.organization.id, kind: "payment",
        amount: formatMinor(moneyMinor(input.amount)), currency: input.currency, paymentDate: input.paymentDate,
        method: input.method.trim(),
        ...(input.externalReference === undefined ? {} : { externalReference: input.externalReference.trim() }),
        ...(input.note === undefined ? {} : { note: input.note.trim() }),
        actorId: context.identity.id, createdAt: now.toISOString(),
      }
      yield* transaction.savePayment(payment)
      yield* transaction.saveIdempotencyRecord(idempotencyRecord(context.organization.id, idempotency, "record_payment", payment.id, payment.createdAt))
      return { payment, ...summarize(invoice, [...existing, payment], now) }
    }))
  })
  const reversePayment = ({ request: input, idempotency }: Idempotent<ReversePaymentInput>): Effect.Effect<RecordPaymentResult, PaymentsFailure> => Effect.gen(function*() {
    validateReversePaymentInput(input)
    yield* validateAttempt(idempotency)
    const context = yield* authorized(permissions.record, legacyPaymentsPermissions.record); const id = yield* dependencies.ids.next; const now = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const invoice = yield* transaction.findInvoiceSnapshot(context.organization.id, input.invoiceId)
      if (invoice === undefined) return yield* Effect.fail(missingInvoice(input.invoiceId))
      const replayId = yield* findReplay(transaction, context.organization.id, idempotency, "reverse_payment")
      if (replayId !== undefined) return yield* replayed(transaction, context, invoice, replayId, now)
      const original = yield* transaction.findPayment(context.organization.id, input.invoiceId, input.paymentId)
      if (original === undefined || original.kind !== "payment") return yield* Effect.fail(missingPayment(input.paymentId))
      const existing = yield* transaction.listPayments(context.organization.id, input.invoiceId)
      if (existing.some((payment) => payment.reversesPaymentId === original.id)) {
        return yield* Effect.fail(new DomainConflict({ code: "payment_already_reversed", message: "Payment was already reversed" }))
      }
      const reason = input.reason?.trim()
      const reversal: Payment = {
        id, invoiceId: input.invoiceId, organizationId: context.organization.id, kind: "reversal", reversesPaymentId: original.id,
        amount: original.amount, currency: original.currency, paymentDate: calendarDate(now), method: original.method,
        ...(reason === undefined ? {} : { note: reason }),
        actorId: context.identity.id, createdAt: now.toISOString(),
      }
      yield* transaction.savePayment(reversal)
      yield* transaction.saveIdempotencyRecord(idempotencyRecord(context.organization.id, idempotency, "reverse_payment", reversal.id, reversal.createdAt))
      return { payment: reversal, ...summarize(invoice, [...existing, reversal], now) }
    }))
  })
  const listPayments = (invoiceId: string): Effect.Effect<InvoicePaymentSummary, PaymentsFailure> => Effect.gen(function*() {
    const context = yield* authorized(permissions.read, legacyPaymentsPermissions.read); const now = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const invoice = yield* transaction.findInvoiceSnapshot(context.organization.id, invoiceId)
      if (invoice === undefined) return yield* Effect.fail(missingInvoice(invoiceId))
      const payments = yield* transaction.listPayments(context.organization.id, invoiceId)
      return { invoiceId, ...summarize(invoice, payments, now), payments }
    }))
  })
  return { recordPayment, reversePayment, listPayments }
}
export type PaymentsService = ReturnType<typeof createPaymentsService>
export type { PaymentsTransaction } from "./ports.ts"
