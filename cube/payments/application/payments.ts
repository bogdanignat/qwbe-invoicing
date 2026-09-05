import { Effect } from "effect"

import { PermissionDenied, ResourceNotFound, ValidationFailure, type PaymentsFailure } from "../contracts/failures.ts"
import type { Clock, IdGenerator, RequestContextProvider, TransactionalStore } from "../contracts/host.ts"
import { legacyPaymentsPermissions, paymentsPermissions } from "../contracts/permissions.ts"
import { derivePaymentStatus, formatMinor, moneyMinor, sumPaymentsMinor, validateRecordPaymentInput, type Payment, type PaymentStatus, type RecordPaymentInput } from "../domain/payments.ts"
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
    paidAmount: formatMinor(paid), remainingAmount: formatMinor(remaining < 0n ? 0n : remaining),
  }
}
const missingInvoice = (id: string) => new ResourceNotFound({ resource: "invoice", id })
export const createPaymentsService = (dependencies: PaymentsDependencies) => {
  const permissions = paymentsPermissions(dependencies.cubeIdentity)
  const authorized = (permission: string, legacyPermission: string) => Effect.flatMap(dependencies.context.current, (context) =>
    context.identity.permissions.includes(permission) || context.identity.permissions.includes(legacyPermission)
      ? Effect.succeed(context)
      : Effect.fail(new PermissionDenied({ permission })))
  const recordPayment = (input: RecordPaymentInput): Effect.Effect<RecordPaymentResult, PaymentsFailure> => Effect.gen(function*() {
    validateRecordPaymentInput(input)
    const context = yield* authorized(permissions.record, legacyPaymentsPermissions.record); const id = yield* dependencies.ids.next; const now = yield* dependencies.clock.now
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const invoice = yield* transaction.findInvoiceSnapshot(context.organization.id, input.invoiceId)
      if (invoice === undefined) return yield* Effect.fail(missingInvoice(input.invoiceId))
      if (invoice.currency !== input.currency) return yield* Effect.fail(new ValidationFailure({ issues: ["payment currency must match invoice currency"] }))
      const existing = yield* transaction.listPayments(context.organization.id, input.invoiceId)
      const payment: Payment = {
        id, invoiceId: input.invoiceId, organizationId: context.organization.id,
        amount: formatMinor(moneyMinor(input.amount)), currency: input.currency, paymentDate: input.paymentDate,
        method: input.method.trim(),
        ...(input.externalReference === undefined ? {} : { externalReference: input.externalReference.trim() }),
        ...(input.note === undefined ? {} : { note: input.note.trim() }),
        actorId: context.identity.id, createdAt: now.toISOString(),
      }
      yield* transaction.savePayment(payment)
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
  return { recordPayment, listPayments }
}
export type PaymentsService = ReturnType<typeof createPaymentsService>
export type { PaymentsTransaction } from "./ports.ts"
