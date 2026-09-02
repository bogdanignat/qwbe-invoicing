import type { CorrectionDocument, PaymentSummary } from "./models.ts"

export interface InvoiceActionState {
  readonly canRecordPayment: boolean
  readonly canCreateFullCorrection: boolean
  readonly isOverpaid: boolean
}

const hasPositiveBalance = (value: string): boolean => /^\d+\.\d{2}$/.test(value) && BigInt(value.replace(".", "")) > 0n

export const invoiceActionState = (paymentSummary: PaymentSummary, corrections: ReadonlyArray<CorrectionDocument>): InvoiceActionState => ({
  canRecordPayment: hasPositiveBalance(paymentSummary.remainingAmount),
  canCreateFullCorrection: corrections.length === 0,
  isOverpaid: paymentSummary.status === "overpaid",
})
