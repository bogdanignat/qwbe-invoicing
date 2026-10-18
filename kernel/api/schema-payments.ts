import { Schema } from "effect"

import { bodyObject, optionalString } from "./schema-primitives.ts"

export const PaymentInput = Schema.Struct({
  amount: Schema.String, currency: Schema.String, paymentDate: Schema.String, method: Schema.String,
  externalReference: optionalString, note: optionalString,
}).annotations(bodyObject)
export const PaymentStatus = Schema.Literal("unpaid", "partially_paid", "paid", "overpaid", "overdue")
export const ReversalInput = Schema.Struct({ reason: optionalString }).annotations(bodyObject)
export const Payment = Schema.Struct({
  id: Schema.String, invoiceId: Schema.String, organizationId: Schema.String,
  kind: Schema.Literal("payment", "reversal"), reversesPaymentId: optionalString,
  amount: Schema.String, currency: Schema.String, paymentDate: Schema.String, method: Schema.String,
  externalReference: optionalString, note: optionalString, actorId: Schema.String, createdAt: Schema.String,
})
export const RecordPaymentResult = Schema.Struct({
  payment: Payment, status: PaymentStatus, paidAmount: Schema.String, remainingAmount: Schema.String,
})
export const PaymentSummary = Schema.Struct({
  invoiceId: Schema.String, status: PaymentStatus, paidAmount: Schema.String,
  remainingAmount: Schema.String, payments: Schema.Array(Payment),
})
