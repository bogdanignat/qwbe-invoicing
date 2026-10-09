import { encoded } from "./client-paths.ts"
import { decodePaymentSummary } from "./payment-decoders.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type { PaymentInput, PaymentSummary } from "./payment-models.ts"

/**
 * The payment ledger of an issued invoice: read it, add a payment, reverse one.
 *
 * Both writes carry the session's CSRF token and an idempotency key — the
 * backend requires the two on every ledger write (`idempotentBody`,
 * standalone/api/http-endpoints-fiscal.ts). Their answers are not decoded: the
 * screen refetches the summary after a write rather than deriving state from
 * a `RecordPaymentResult`, so the summary decoder stays the only reader of the
 * ledger.
 */
export interface PaymentsClient {
  readonly summary: (invoiceId: string, signal: AbortSignal) => Promise<PaymentSummary>
  readonly record: (csrfToken: string, invoiceId: string, body: PaymentInput, idempotencyKey: string) => Promise<void>
  readonly reverse: (csrfToken: string, invoiceId: string, paymentId: string, idempotencyKey: string) => Promise<void>
}

export const createPaymentsClient = (transport: BrowserTransport): PaymentsClient => {
  const path = (invoiceId: string): string => `/api/invoices/${encoded(invoiceId)}/payments`
  return {
    summary: async (invoiceId, signal) => decodePaymentSummary(await transport.json(path(invoiceId), { signal })),
    record: async (csrfToken, invoiceId, body, idempotencyKey) => {
      await transport.json(path(invoiceId), { method: "POST", body, csrfToken, idempotencyKey })
    },
    // The reversal body is an object even without a reason: the schema refuses anything else.
    reverse: async (csrfToken, invoiceId, paymentId, idempotencyKey) => {
      await transport.json(`${path(invoiceId)}/${encoded(paymentId)}/reversal`, {
        method: "POST", body: {}, csrfToken, idempotencyKey,
      })
    },
  }
}
