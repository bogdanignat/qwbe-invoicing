import { ValidationFailure } from "../contracts/failures.ts"

// Same rule as the invoicing cube: the fiscal "today" is the Romanian calendar day, not UTC.
export const organizationTimeZone = "Europe/Bucharest"
export const calendarDate = (instant: Date, timeZone: string = organizationTimeZone): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant)

export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "overpaid" | "overdue"
// A reversal is a second immutable row that cancels one payment in full; nothing is ever edited or deleted.
export type PaymentKind = "payment" | "reversal"
export interface Payment {
  readonly id: string
  readonly invoiceId: string
  readonly organizationId: string
  readonly kind: PaymentKind
  readonly reversesPaymentId?: string
  readonly amount: string
  readonly currency: string
  readonly paymentDate: string
  readonly method: string
  readonly externalReference?: string
  readonly note?: string
  readonly actorId: string
  readonly createdAt: string
}
export interface ReversePaymentInput {
  readonly invoiceId: string
  readonly paymentId: string
  readonly reason?: string
}
export interface IdempotencyAttempt { readonly key: string; readonly fingerprint: string }
export interface Idempotent<Input> { readonly request: Input; readonly idempotency: IdempotencyAttempt }
export type PaymentOperation = "record_payment" | "reverse_payment"
export interface PaymentIdempotencyRecord extends IdempotencyAttempt {
  readonly organizationId: string
  readonly operation: PaymentOperation
  readonly resultId: string
  readonly createdAt: string
}
export interface RecordPaymentInput {
  readonly invoiceId: string
  readonly amount: string
  readonly currency: string
  readonly paymentDate: string
  readonly method: string
  readonly externalReference?: string
  readonly note?: string
}

const parseMoneyMinor = (value: string, field: string): bigint => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (match === null) throw new ValidationFailure({ issues: [`${field} must be a non-negative amount with at most two decimals`] })
  const total = BigInt(match[1] ?? "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0")
  if (total <= 0n) throw new ValidationFailure({ issues: [`${field} must be greater than zero`] })
  return total
}
const validateDate = (value: string, field: string): void => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) throw new ValidationFailure({ issues: [`${field} must be a calendar date in YYYY-MM-DD format`] })
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ValidationFailure({ issues: [`${field} must be a valid calendar date`] })
  }
}
export const validateRecordPaymentInput = (input: RecordPaymentInput): void => {
  const issues: Array<string> = []
  if (input.invoiceId.trim().length === 0) issues.push("invoiceId is required")
  try { parseMoneyMinor(input.amount, "amount") } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) issues.push("currency must be an ISO 4217 code")
  if (input.method.trim().length === 0) issues.push("method is required")
  if (input.externalReference !== undefined && input.externalReference.trim().length === 0) issues.push("externalReference must not be empty when provided")
  if (input.note !== undefined && input.note.trim().length === 0) issues.push("note must not be empty when provided")
  try { validateDate(input.paymentDate, "paymentDate") } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}
export const validateReversePaymentInput = (input: ReversePaymentInput): void => {
  const issues: Array<string> = []
  if (input.invoiceId.trim().length === 0) issues.push("invoiceId is required")
  if (input.paymentId.trim().length === 0) issues.push("paymentId is required")
  if (input.reason !== undefined && input.reason.trim().length === 0) issues.push("reason must not be empty when provided")
  if (input.reason !== undefined && input.reason.trim().length > 500) issues.push("reason must be at most 500 characters")
  if (issues.length > 0) throw new ValidationFailure({ issues })
}
export const moneyMinor = (value: string): bigint => {
  const match = /^(\d+)\.(\d{2})$/.exec(value.trim())
  return match === null ? parseMoneyMinor(value, "money") : BigInt(match[1] ?? "0") * 100n + BigInt(match[2] ?? "0")
}
export const sumPaymentsMinor = (payments: ReadonlyArray<Payment>): bigint =>
  payments.reduce((total, payment) => total + (payment.kind === "reversal" ? -moneyMinor(payment.amount) : moneyMinor(payment.amount)), 0n)
export const derivePaymentStatus = (input: {
  readonly totalIncludingVat: string
  readonly dueDate: string | null
  readonly payments: ReadonlyArray<Payment>
  readonly now: Date
}): PaymentStatus => {
  const total = moneyMinor(input.totalIncludingVat); const paid = sumPaymentsMinor(input.payments)
  let status: PaymentStatus = paid === 0n ? "unpaid" : paid < total ? "partially_paid" : paid === total ? "paid" : "overpaid"
  if (input.dueDate !== null && (status === "unpaid" || status === "partially_paid")
    && input.dueDate < calendarDate(input.now)) status = "overdue"
  return status
}
export const formatMinor = (value: bigint): string =>
  `${(value / 100n).toString()}.${(value % 100n).toString().padStart(2, "0")}`
