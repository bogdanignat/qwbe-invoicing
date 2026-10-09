"use client"

import { queryOptions, useMutation, useQuery } from "@tanstack/react-query"
import { useRef } from "react"

import { useAuth } from "./auth-context.ts"
import { useAuthoringRecovery } from "./use-authoring-recovery.ts"
import { useCorrectionIssuanceController } from "./use-correction-issuance-controller.ts"
import { invoiceQueryOptions, retryAction } from "./use-document-detail.ts"
import { useInvoicingClients, type InvoicingClients } from "./use-invoicing-clients.ts"
import type { CorrectionOutcome } from "../lib/correction-issuance-types.ts"
import {
  CORRECTION_CONFIRM, correctionInputFrom, correctionSummary, correctionsView, type CorrectionsView,
} from "../lib/correction-state.ts"
import type { CorrectionInput } from "../lib/document-snapshot.ts"
import { knownResultNotice, type KnownWrite, type RecoveryNoticeModel } from "../lib/operation-recovery-view.ts"
import type { RecoveryRecord } from "../lib/operation-recovery-types.ts"

/** One definition of the corrections read, shared by the storno section and the payments panel. */
export const correctionsQueryOptions = (clients: InvoicingClients, invoiceId: string, enabled: boolean) => queryOptions({
  queryKey: ["invoice", invoiceId, "corrections"],
  enabled,
  queryFn: ({ signal }) => clients.documents.listCorrections(invoiceId, signal),
})

export interface InvoiceCorrectionsModel {
  /** Absent until the corrections list has answered. */
  readonly view: CorrectionsView | undefined
  readonly isPending: boolean
  /** The list read first, then the last issuance, then a replay: one alert, the most fundamental failure. */
  readonly error: unknown
  readonly retry: (() => void) | undefined
  readonly pending: boolean
  readonly canIssue: boolean
  readonly unconfirmedMessage: string | undefined
  /** The server settled the request as a state of the invoice: it already has its storno. */
  readonly alreadyCorrected: string | undefined
  readonly notice: RecoveryNoticeModel | undefined
  readonly noticePending: boolean
  readonly replay: (record: RecoveryRecord) => void
  readonly dismiss: () => void
  readonly issue: (form: FormData) => void
}

const knownWrite = (outcome: CorrectionOutcome | undefined): KnownWrite | undefined =>
  outcome?.kind === "issued" && outcome.effectsError !== undefined
    ? { kind: "correction", id: outcome.correction.id, effectsError: outcome.effectsError }
    : undefined

const failureOf = (outcome: CorrectionOutcome | undefined): unknown => {
  if (outcome?.kind === "error") return outcome.error
  return outcome?.kind === "issued" ? outcome.effectsError ?? null : null
}

/**
 * The storno half of the invoice screen: the list, the confirm dialog, and
 * whether the form may be offered. The request and its effects live in the
 * controller hook, behind the recovery journal and the session checks.
 *
 * `useMutation` is not single-flight on its own — `isPending` reaches the button
 * only on the next render — so the ref is set before `mutate` and cleared when
 * it settles; the controller refuses a second press as `busy` behind it.
 */
export const useInvoiceCorrections = (invoiceId: string): InvoiceCorrectionsModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const enabled = auth.status === "authenticated"
  const list = useQuery(correctionsQueryOptions(clients, invoiceId, enabled))
  const invoice = useQuery(invoiceQueryOptions(clients, invoiceId, enabled)).data
  const recovery = useAuthoringRecovery()
  const controller = useCorrectionIssuanceController(recovery.port)
  const inFlight = useRef(false)
  const mutation = useMutation({
    mutationFn: (body: CorrectionInput): Promise<CorrectionOutcome> => (invoice === undefined
      ? Promise.reject(new Error("Factura nu este încărcată."))
      : controller.issue({
        invoiceId, body, summary: correctionSummary(invoice, body),
        // The real reason writing is closed: an unresolved journal entry refuses the request where it is sent.
        blockedMessage: recovery.notice?.message,
      })),
    onSettled: () => { inFlight.current = false },
  })
  const known = knownWrite(mutation.data)
  const alreadyCorrected = mutation.data?.kind === "already-corrected" ? mutation.data.message : undefined
  const view = list.data === undefined ? undefined : correctionsView(list.data)
  const canIssue = view?.canIssue === true && invoice !== undefined && !mutation.isPending
    && !recovery.blocked && known === undefined && alreadyCorrected === undefined
  return {
    view,
    isPending: list.isPending,
    error: list.error ?? failureOf(mutation.data) ?? mutation.error ?? recovery.error,
    retry: retryAction(list.error, () => { void list.refetch() }),
    pending: mutation.isPending,
    canIssue,
    unconfirmedMessage: controller.unconfirmedIssue(),
    alreadyCorrected,
    notice: recovery.notice ?? knownResultNotice(known),
    noticePending: recovery.pending,
    replay: recovery.replay,
    dismiss: () => { mutation.reset(); recovery.dismiss() },
    issue: (form) => {
      if (inFlight.current || !canIssue) return
      const body = correctionInputFrom(form)
      if (!window.confirm(CORRECTION_CONFIRM)) return
      inFlight.current = true
      mutation.mutate(body)
    },
  }
}
