import { array, object, optionalText, text, type Decoder } from "./model-decoder.ts"
import {
  PAYMENT_KINDS, PAYMENT_STATUSES, type Payment, type PaymentSummary,
} from "./payment-models.ts"

/**
 * A literal the screen branches on is checked against the list it is typed
 * from: an unknown `kind` would otherwise render as a payment with a reverse
 * button, and an unknown `status` as a badge with no label.
 */
const literal = <Value extends string>(allowed: ReadonlyArray<Value>, input: unknown, field: string): Value => {
  const value = text(input, field)
  const match = allowed.find((candidate) => candidate === value)
  if (match === undefined) throw new Error(`invalid ${field}`)
  return match
}

const decodePayment: Decoder<Payment> = (input) => {
  const value = object(input)
  const reversesPaymentId = optionalText(value.reversesPaymentId, "reversesPaymentId")
  const externalReference = optionalText(value.externalReference, "externalReference")
  const note = optionalText(value.note, "note")
  return {
    id: text(value.id, "id"),
    kind: literal(PAYMENT_KINDS, value.kind, "kind"),
    ...(reversesPaymentId === undefined ? {} : { reversesPaymentId }),
    amount: text(value.amount, "amount"),
    currency: text(value.currency, "currency"),
    paymentDate: text(value.paymentDate, "paymentDate"),
    method: text(value.method, "method"),
    ...(externalReference === undefined ? {} : { externalReference }),
    ...(note === undefined ? {} : { note }),
    actorId: text(value.actorId, "actorId"),
  }
}

export const decodePaymentSummary: Decoder<PaymentSummary> = (input) => {
  const value = object(input)
  return {
    invoiceId: text(value.invoiceId, "invoiceId"),
    status: literal(PAYMENT_STATUSES, value.status, "status"),
    paidAmount: text(value.paidAmount, "paidAmount"),
    remainingAmount: text(value.remainingAmount, "remainingAmount"),
    payments: array(value.payments, decodePayment, "payments"),
  }
}
