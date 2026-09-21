import { array, integer, object, optionalText, text, type Decoder } from "./model-decoder.ts"
import { optionalDocumentSource } from "./document-decoders.ts"
import { decodeIssuedIssuerCompanySnapshot } from "./party-decoders.ts"
import type { CorrectionDocument, Payment, PaymentSummary } from "./document-models.ts"

const decodePayment: Decoder<Payment> = (input) => {
  const value = object(input)
  const externalReference = optionalText(value.externalReference, "externalReference")
  const note = optionalText(value.note, "note")
  const kind = text(value.kind, "kind")
  if (kind !== "payment" && kind !== "reversal") throw new Error("invalid payment kind")
  const reversesPaymentId = optionalText(value.reversesPaymentId, "reversesPaymentId")
  return {
    actorId: text(value.actorId, "actorId"),
    id: text(value.id, "id"),
    kind,
    ...(reversesPaymentId === undefined ? {} : { reversesPaymentId }),
    amount: text(value.amount, "amount"),
    currency: text(value.currency, "currency"),
    paymentDate: text(value.paymentDate, "paymentDate"),
    method: text(value.method, "method"),
    ...(externalReference === undefined ? {} : { externalReference }),
    ...(note === undefined ? {} : { note }),
  }
}

export const decodePaymentSummary: Decoder<PaymentSummary> = (input) => {
  const value = object(input)
  const status = text(value.status, "status")
  if (!["unpaid", "partially_paid", "paid", "overpaid", "overdue"].includes(status)) {
    throw new Error("invalid payment status")
  }
  return {
    invoiceId: text(value.invoiceId, "invoiceId"),
    status: status as PaymentSummary["status"],
    paidAmount: text(value.paidAmount, "paidAmount"),
    remainingAmount: text(value.remainingAmount, "remainingAmount"),
    payments: array(value.payments, decodePayment, "payments"),
  }
}

export const decodeCorrection: Decoder<CorrectionDocument> = (input) => {
  const value = object(input)
  const source = optionalDocumentSource(value.source)
  return {
    actorId: text(value.actorId, "actorId"),
    id: text(value.id, "id"),
    ...(source === undefined ? {} : { source }),
    series: text(value.series, "series"),
    number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"),
    reason: text(value.reason, "reason"),
    issuer: decodeIssuedIssuerCompanySnapshot(value.issuer),
    currency: text(value.currency, "currency"),
    totalIncludingVat: text(value.totalIncludingVat, "totalIncludingVat"),
  }
}
