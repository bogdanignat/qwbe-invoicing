import { array, literal, object, optionalText, text, type Decoder } from "./model-decoder.ts"
import {
  PAYMENT_KINDS, PAYMENT_STATUSES, type Payment, type PaymentSummary,
} from "./payment-models.ts"

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
