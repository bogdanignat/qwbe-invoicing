import { ValidationFailure } from "../contracts/failures.ts"

export type PaymentStatus = "unpaid" | "partially_paid" | "paid" | "overpaid" | "overdue"

export interface Payment {
  readonly id: string
  readonly invoiceId: string
  readonly organizationId: string
  readonly amount: string
  readonly currency: string
  readonly paymentDate: string
  readonly method: string
  readonly externalReference?: string
  readonly note?: string
  readonly actorId: string
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
  const trimmed = value.trim()
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed)
  if (match === null) throw new ValidationFailure({ issues: [`${field} must be a non-negative amount with at most two decimals`] })
  const whole = BigInt(match[1] ?? "0") * 100n
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0") || "0")
  const total = whole + fraction
  if (total <= 0n) throw new ValidationFailure({ issues: [`${field} must be greater than zero`] })
  return total
}

export const validateRecordPaymentInput = (input: RecordPaymentInput): void => {
  const issues: Array<string> = []
  if (input.invoiceId.trim().length === 0) issues.push("invoiceId is required")
  try { parseMoneyMinor(input.amount, "amount") } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  if (!/^[A-Z]{3}$/.test(input.currency)) issues.push("currency must be an ISO 4217 code")
  if (input.method.trim().length === 0) issues.push("method is required")
  if (input.externalReference !== undefined && input.externalReference.trim().length === 0) {
    issues.push("externalReference must not be empty when provided")
  }
  if (input.note !== undefined && input.note.trim().length === 0) issues.push("note must not be empty when provided")
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.paymentDate)
  if (dateMatch === null) {
    issues.push("paymentDate must be a calendar date in YYYY-MM-DD format")
  } else {
    const year = Number(dateMatch[1])
    const month = Number(dateMatch[2])
    const day = Number(dateMatch[3])
    const date = new Date(Date.UTC(year, month - 1, day))
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
      issues.push("paymentDate must be a valid calendar date")
    }
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

const moneyMinor = (value: string): bigint => {
  const match = /^(\d+)\.(\d{2})$/.exec(value.trim())
  if (match === null) return parseMoneyMinor(value, "money")
  return BigInt(match[1] ?? "0") * 100n + BigInt(match[2] ?? "0")
}

export const sumPaymentsMinor = (payments: ReadonlyArray<Payment>): bigint =>
  payments.reduce((total, payment) => total + moneyMinor(payment.amount), 0n)

export const derivePaymentStatus = (input: {
  readonly totalIncludingTax: string
  readonly dueDate: string
  readonly payments: ReadonlyArray<Payment>
  readonly now: Date
}): PaymentStatus => {
  const total = moneyMinor(input.totalIncludingTax)
  const paid = sumPaymentsMinor(input.payments)
  let status: PaymentStatus
  if (paid === 0n) status = "unpaid"
  else if (paid < total) status = "partially_paid"
  else if (paid === total) status = "paid"
  else status = "overpaid"
  if ((status === "unpaid" || status === "partially_paid") && input.dueDate < input.now.toISOString().slice(0, 10)) {
    return "overdue"
  }
  return status
}

export const formatMinor = (value: bigint): string => {
  const whole = value / 100n
  const fraction = (value % 100n).toString().padStart(2, "0")
  return `${whole.toString()}.${fraction}`
}
