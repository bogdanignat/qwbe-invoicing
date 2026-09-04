import { HttpApiGroup } from "@effect/platform"

import { paymentsPermissions } from "./contracts/permissions.ts"

const identity = "payments"
const permissions = paymentsPermissions(identity)
export const cube = {
  manifest: {
    name: identity,
    tables: ["invoice_payments"],
    requiresAuth: true,
    permissions: [permissions.read, permissions.record].map((name) => ({ name, roles: ["admin"] })),
  },
  create: () => ({ group: HttpApiGroup.make(identity), handlers: {} }),
}

export * from "./contracts/index.ts"
export * from "./domain/payments.ts"
export { createPaymentsService } from "./application/payments.ts"
export type { InvoicePaymentSummary, PaymentsDependencies, PaymentsService, RecordPaymentResult } from "./application/payments.ts"
export type { InvoiceSnapshot, PaymentsTransaction } from "./application/ports.ts"
