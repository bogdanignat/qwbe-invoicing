const identity = "payments"
export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    tables: ["invoice_payments", "payment_idempotency_records"],
    requiresAuth: true,
    permissions: [],
  },
}

export * from "./contracts/index.ts"
export * from "./domain/payments.ts"
export { createPaymentsService } from "./application/payments.ts"
export type { InvoicePaymentSummary, PaymentsDependencies, PaymentsService, RecordPaymentResult } from "./application/payments.ts"
export type { InvoiceSnapshot, PaymentsTransaction } from "./application/ports.ts"
