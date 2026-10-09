/**
 * The payment ledger of one invoice, as `GET /api/invoices/{id}/payments`
 * answers it (standalone/api/schema-payments.ts), narrowed to what the screen
 * renders: `invoiceId`, `organizationId` and `createdAt` on each entry are not
 * carried into the model.
 *
 * Amounts stay the decimal strings the backend computed; a balance is never
 * re-derived here.
 */
export const PAYMENT_STATUSES = ["unpaid", "partially_paid", "paid", "overpaid", "overdue"] as const
export type PaymentStatus = typeof PAYMENT_STATUSES[number]

/** A reversal is its own ledger entry pointing at the payment it cancels; nothing is ever deleted. */
export const PAYMENT_KINDS = ["payment", "reversal"] as const
export type PaymentKind = typeof PAYMENT_KINDS[number]

export interface Payment {
  readonly id: string
  readonly kind: PaymentKind
  readonly reversesPaymentId?: string
  readonly amount: string
  readonly currency: string
  readonly paymentDate: string
  readonly method: string
  readonly externalReference?: string
  readonly note?: string
  readonly actorId: string
}

export interface PaymentSummary {
  readonly invoiceId: string
  readonly status: PaymentStatus
  readonly paidAmount: string
  readonly remainingAmount: string
  readonly payments: ReadonlyArray<Payment>
}

/** The body of `POST /api/invoices/{id}/payments`: the optional fields are absent, never empty. */
export interface PaymentInput {
  readonly amount: string
  readonly currency: string
  readonly paymentDate: string
  readonly method: string
  readonly externalReference?: string
  readonly note?: string
}
