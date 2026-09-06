import { Effect } from "effect"

import { ValidationFailure, type PaymentsFailure } from "../contracts/failures.ts"
import { legacyPaymentsPermissions, paymentsPermissions } from "../contracts/permissions.ts"
import { formatMinor, moneyMinor, validateRecordPaymentInput, type Idempotent, type Payment, type RecordPaymentInput } from "../domain/payments.ts"
import { findReplay, idempotencyRecord, validateAttempt } from "./idempotency.ts"
import { createReversePayment } from "./reversals.ts"
import { audit, createAuthorize, missingInvoice, replayed, summarize, type InvoicePaymentSummary, type PaymentsDependencies, type RecordPaymentResult } from "./support.ts"

export const createPaymentsService = (dependencies: PaymentsDependencies) => {
  const permissions = paymentsPermissions(dependencies.cubeIdentity)
  const authorized = createAuthorize(dependencies)
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
      yield* audit(transaction, context, dependencies, now, { action: "payment.recorded", targetKind: "payment", targetId: payment.id })
      return { payment, ...summarize(invoice, [...existing, payment], now) }
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
  return { recordPayment, reversePayment: createReversePayment(dependencies, authorized), listPayments }
}
export type PaymentsService = ReturnType<typeof createPaymentsService>
export type { InvoicePaymentSummary, PaymentsDependencies, RecordPaymentResult } from "./support.ts"
export type { PaymentsTransaction } from "./ports.ts"
