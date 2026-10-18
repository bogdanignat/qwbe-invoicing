import { queryOptions } from "@tanstack/react-query"

import { correctionsQueryOptions, invoiceQueryOptions } from "./use-document-detail.ts"
import type { InvoicingClients } from "./use-invoicing-clients.ts"
import type { PaymentsView } from "../lib/payment-state.ts"

export interface InvoicePaymentsModel {
  /** Absent until the ledger, the invoice it is priced in and the invoice's corrections have answered. */
  readonly view: PaymentsView | undefined
  readonly isPending: boolean
  /** The ledger read first, then the last write: one alert, the most fundamental failure. */
  readonly error: unknown
  readonly retry: (() => void) | undefined
  readonly notice: string | undefined
  readonly pending: boolean
  readonly record: (form: FormData) => void
  readonly reverse: (paymentId: string) => void
}

export interface PaymentWrite {
  readonly operation: "record" | "reverse"
  readonly fingerprint: string
  readonly notice: string
  readonly send: (csrfToken: string, idempotencyKey: string) => Promise<void>
}

/** The ledger read; `enabled` only with the payments plugin on in an authenticated session. */
const paymentsQueryOptions = (
  clients: Pick<InvoicingClients, "payments">, invoiceId: string, enabled: boolean,
) => queryOptions({
  queryKey: ["invoice", invoiceId, "payments"],
  enabled,
  queryFn: ({ signal }) => clients.payments.summary(invoiceId, signal),
})

/**
 * The three reads the payments panel observes: the ledger, the invoice it is
 * priced in and the invoice's corrections (the same key as the storno section:
 * one fetch, one cache). One `enabled` for all three, so with the payments
 * plugin off the panel itself asks for nothing.
 */
export const invoicePaymentsQueries = (
  clients: Pick<InvoicingClients, "payments" | "documents">, invoiceId: string, enabled: boolean,
) => ({
  ledger: paymentsQueryOptions(clients, invoiceId, enabled),
  invoice: invoiceQueryOptions(clients, invoiceId, enabled),
  corrections: correctionsQueryOptions(clients, invoiceId, enabled),
})
