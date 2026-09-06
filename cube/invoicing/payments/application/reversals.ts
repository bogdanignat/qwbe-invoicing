import { Effect } from "effect"

import { DomainConflict, type PaymentsFailure } from "../contracts/failures.ts"
import { legacyPaymentsPermissions, paymentsPermissions } from "../contracts/permissions.ts"
import { calendarDate, validateReversePaymentInput, type Idempotent, type Payment, type ReversePaymentInput } from "../domain/payments.ts"
import { findReplay, idempotencyRecord, validateAttempt } from "./idempotency.ts"
import { audit, missingInvoice, missingPayment, replayed, summarize, type Authorize, type PaymentsDependencies, type RecordPaymentResult } from "./support.ts"

// A reversal is a second, immutable ledger entry that mirrors the original payment; the original is never edited.
export const createReversePayment = (dependencies: PaymentsDependencies, authorized: Authorize) => {
  const permissions = paymentsPermissions(dependencies.cubeIdentity)
  return ({ request: input, idempotency }: Idempotent<ReversePaymentInput>): Effect.Effect<RecordPaymentResult, PaymentsFailure> => Effect.gen(function*() {
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
      yield* audit(transaction, context, dependencies, now, { action: "payment.reversed", targetKind: "payment", targetId: reversal.id, ...(reason === undefined ? {} : { reason }) })
      return { payment: reversal, ...summarize(invoice, [...existing, reversal], now) }
    }))
  })
}
