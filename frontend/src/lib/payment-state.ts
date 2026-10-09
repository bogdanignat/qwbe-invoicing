import type { CorrectionRef } from "./correction-state.ts"
import { money } from "./format.ts"
import type { PaymentInput, PaymentStatus, PaymentSummary } from "./payment-models.ts"

/**
 * What the payments panel may offer and how it reads, decided from the ledger
 * the server answered and nothing else. The backend validates every amount and
 * date; the screen only decides which controls exist.
 */
export interface PaymentActionState {
  readonly canRecordPayment: boolean
  readonly isOverpaid: boolean
}

/** Only a well-formed, strictly positive balance (`"12.34"`) leaves room for a payment. */
const hasPositiveBalance = (value: string): boolean =>
  /^\d+\.\d{2}$/u.test(value) && BigInt(value.replace(".", "")) > 0n

export const paymentActionState = (summary: PaymentSummary): PaymentActionState => ({
  canRecordPayment: hasPositiveBalance(summary.remainingAmount),
  isOverpaid: summary.status === "overpaid",
})

const STATUS_LABELS: Readonly<Record<PaymentStatus, string>> = {
  unpaid: "Neplătită",
  partially_paid: "Plătită parțial",
  paid: "Plătită",
  overpaid: "Plătită în exces",
  overdue: "Scadentă",
}

export type PaymentStatusTone = "muted" | "info" | "positive" | "storno"

/** `overdue` reads like `unpaid`: only the label differs (the Vite panel did the same). */
const STATUS_TONES: Readonly<Record<PaymentStatus, PaymentStatusTone>> = {
  unpaid: "muted",
  partially_paid: "info",
  paid: "positive",
  overpaid: "storno",
  overdue: "muted",
}

export const paymentStatusLabel = (status: PaymentStatus): string => STATUS_LABELS[status]
export const paymentStatusTone = (status: PaymentStatus): PaymentStatusTone => STATUS_TONES[status]

export const PAYMENT_METHODS: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: "transfer", label: "Transfer bancar" },
  { value: "card", label: "Card" },
  { value: "cash", label: "Numerar" },
  { value: "other", label: "Alta" },
]

/** A method recorded outside this screen is shown as stored rather than hidden. */
export const paymentMethodLabel = (method: string): string =>
  PAYMENT_METHODS.find((entry) => entry.value === method)?.label ?? method

/** The payments a reversal already cancelled: they must not be offered for reversal again. */
export const reversedPaymentIds = (summary: PaymentSummary): ReadonlySet<string> =>
  new Set(summary.payments.flatMap((payment) => payment.reversesPaymentId === undefined ? [] : [payment.reversesPaymentId]))

const formText = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === "string" ? value.trim() : ""
}

/**
 * The request body from the submitted form. Optional fields left empty are
 * omitted rather than sent as `""`, so the ledger never stores a blank
 * reference; the currency is the invoice's, never a field.
 */
export const paymentInputFrom = (form: FormData, currency: string): PaymentInput => {
  const externalReference = formText(form, "externalReference")
  const note = formText(form, "note")
  return {
    amount: formText(form, "amount"),
    currency,
    paymentDate: formText(form, "paymentDate"),
    method: formText(form, "method"),
    ...(externalReference === "" ? {} : { externalReference }),
    ...(note === "" ? {} : { note }),
  }
}

export interface PaymentRow {
  readonly id: string
  readonly amount: string
  readonly caption: string
  readonly reference: string | undefined
  readonly note: string | undefined
  readonly isReversal: boolean
  readonly canReverse: boolean
  /** The accessible name of the reverse button: three bare „Anulează” would not say which payment goes. */
  readonly reverseLabel: string
}

export const paymentRows = (summary: PaymentSummary): ReadonlyArray<PaymentRow> => {
  const reversed = reversedPaymentIds(summary)
  return summary.payments.map((payment) => {
    const isReversal = payment.kind === "reversal"
    return {
      id: payment.id,
      amount: `${isReversal ? "−" : ""}${money(payment.amount, payment.currency)}`,
      caption: `${isReversal ? "Stornare plată" : paymentMethodLabel(payment.method)} · ${payment.paymentDate}`,
      reference: payment.externalReference === undefined ? undefined : `Ref. ${payment.externalReference}`,
      note: payment.note,
      isReversal,
      canReverse: !isReversal && !reversed.has(payment.id),
      reverseLabel: `Anulează plata ${money(payment.amount, payment.currency)} · ${payment.paymentDate}`,
    }
  })
}

export interface PaymentsView extends PaymentActionState {
  readonly statusLabel: string
  readonly statusTone: PaymentStatusTone
  readonly paid: string
  readonly remaining: string
  /** The form's default amount: the balance still open, as the server wrote it. */
  readonly remainingAmount: string
  /** Changes with every recorded payment, so the form remounts with fresh defaults. */
  readonly formKey: string
  readonly rows: ReadonlyArray<PaymentRow>
  /** Shown instead of the form on an invoice a storno reversed: no new payment, and why. */
  readonly closedNote: string | undefined
}

/**
 * A reversed invoice takes no new payments. The ledger is not told about the
 * storno — refunds are outside this application — so what was already collected
 * stays recorded and the note says so rather than pretending it was returned.
 */
const stornoNote = (correctedBy: CorrectionRef, summary: PaymentSummary, currency: string): string => {
  const head = `Factura a fost stornată prin ${correctedBy.series} ${String(correctedBy.number)} din ${correctedBy.issueDate}.`
  return hasPositiveBalance(summary.paidAmount)
    ? `${head} Încasările de ${money(summary.paidAmount, currency)} rămân înregistrate; restituirea sau compensarea lor nu se urmărește aici.`
    : `${head} Nu se mai înregistrează plăți.`
}

export const paymentsView = (summary: PaymentSummary, currency: string, correctedBy?: CorrectionRef): PaymentsView => ({
  ...paymentActionState(summary),
  ...(correctedBy === undefined ? {} : { canRecordPayment: false }),
  statusLabel: paymentStatusLabel(summary.status),
  statusTone: paymentStatusTone(summary.status),
  paid: money(summary.paidAmount, currency),
  remaining: money(summary.remainingAmount, currency),
  remainingAmount: summary.remainingAmount,
  formKey: summary.paidAmount,
  rows: paymentRows(summary),
  closedNote: correctedBy === undefined ? undefined : stornoNote(correctedBy, summary, currency),
})

export const REVERSAL_CONFIRM = "Anulezi această plată? Se înregistrează o stornare a plății; înregistrarea inițială rămâne în istoric."
export const PAYMENT_RECORDED = "Plata a fost înregistrată."
export const PAYMENT_REVERSED = "Plata a fost anulată."
