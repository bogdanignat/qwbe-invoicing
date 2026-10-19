"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { invoicePaymentsQueries, type InvoicePaymentsModel, type PaymentWrite } from "./invoice-payments-query.ts"
import { invalidateCollections } from "./report-queries.ts"
import { retryAction } from "./use-document-detail.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { usePluginEnabled } from "./use-plugin-enabled.ts"
import { SESSION_CLOSED } from "./use-registry-writes.ts"
import { isTransientFailure } from "../lib/api-errors.ts"
import { correctionsView } from "../lib/correction-state.ts"
import { createOperationIdempotency, operationFingerprint } from "../lib/operation-idempotency.ts"
import {
  PAYMENT_RECORDED, PAYMENT_REVERSED, REVERSAL_CONFIRM, paymentInputFrom, paymentsView,
} from "../lib/payment-state.ts"
import { registryWriteOutcome } from "../lib/registry-write-outcome.ts"

/**
 * The payments panel of an issued invoice: the ledger read, and the two writes
 * that change it.
 *
 * A payment is not a sealed fiscal document — a duplicate is reversible — so
 * there is no recovery journal here, only the idempotency key: kept when the
 * answer may exist (network, 408, 5xx) so an identical retry replays it,
 * dropped on a settled refusal. A transient failure also refetches the ledger,
 * so the next attempt is made against what the server actually holds, not
 * against a balance a lost answer already changed.
 *
 * `useMutation` is not single-flight: `isPending` reaches the button only on
 * the next render, so an Enter and a click in that gap would send two writes.
 * The ref is set synchronously before `mutate` and cleared when it settles.
 * An answer that outlived its session (`registryWriteOutcome`) leaves no
 * notice, refetch, key change or error behind.
 *
 * With the payments plugin off nothing is read and there is no model: no
 * panel to render and no write to start.
 */
export const useInvoicePayments = (invoiceId: string): InvoicePaymentsModel | undefined => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const enabled = usePluginEnabled("payments")
  const queries = invoicePaymentsQueries(clients, invoiceId, enabled)
  const ledger = useQuery(queries.ledger)
  const currency = useQuery(queries.invoice).data?.currency
  // A reversed invoice takes no new payment.
  const corrections = useQuery(queries.corrections)
  const view = ledger.data === undefined || currency === undefined || corrections.data === undefined
    ? undefined
    : paymentsView(ledger.data, currency, correctionsView(corrections.data).correctedBy)
  const [idempotency] = useState(() => createOperationIdempotency())
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const inFlight = useRef(false)
  // The dashboard's collections read the same ledger, so they go stale with it.
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: queries.ledger.queryKey })
    invalidateCollections(queryClient)
  }
  const mutation = useMutation({
    mutationFn: async (write: PaymentWrite): Promise<PaymentWrite | undefined> => {
      const csrfToken = auth.csrfToken()
      if (csrfToken === undefined) throw new Error(SESSION_CLOSED)
      const epoch = auth.epoch()
      const key = idempotency.current(write.operation, write.fingerprint)
      return await registryWriteOutcome(write, () => write.send(csrfToken, key), () => auth.ownsEpoch(epoch))
    },
    onSuccess: (write) => {
      if (write === undefined) return
      idempotency.complete(write.operation)
      setNotice(write.notice)
      refresh()
    },
    onError: (error, write) => {
      idempotency.fail(write.operation, write.fingerprint, error)
      if (isTransientFailure(error)) refresh()
    },
    onSettled: () => { inFlight.current = false },
  })
  const submit = (write: PaymentWrite): void => {
    inFlight.current = true
    setNotice(undefined)
    mutation.mutate(write)
  }
  if (!enabled) return undefined
  return {
    view,
    isPending: ledger.isPending || corrections.isPending || (ledger.data !== undefined && currency === undefined),
    error: ledger.error ?? corrections.error ?? mutation.error,
    retry: retryAction(ledger.error ?? corrections.error, () => { void ledger.refetch(); void corrections.refetch() }),
    notice,
    pending: mutation.isPending,
    record: (form) => {
      if (inFlight.current || view === undefined || currency === undefined || !view.canRecordPayment) return
      const body = paymentInputFrom(form, currency)
      submit({
        operation: "record", fingerprint: operationFingerprint(body), notice: PAYMENT_RECORDED,
        send: (csrfToken, key) => clients.payments.record(csrfToken, invoiceId, body, key),
      })
    },
    reverse: (paymentId) => {
      if (inFlight.current || !window.confirm(REVERSAL_CONFIRM)) return
      submit({
        operation: "reverse", fingerprint: operationFingerprint({ paymentId }), notice: PAYMENT_REVERSED,
        send: (csrfToken, key) => clients.payments.reverse(csrfToken, invoiceId, paymentId, key),
      })
    },
  }
}
