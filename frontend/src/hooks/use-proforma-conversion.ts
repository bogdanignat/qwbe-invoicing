"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useAuthoringRecovery } from "./use-authoring-recovery.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { useProformaConversionController } from "./use-proforma-conversion-controller.ts"
import { authoringSeriesOptions } from "../lib/document-authoring-options.ts"
import { knownResultNotice, type KnownWrite, type RecoveryNoticeModel } from "../lib/operation-recovery-view.ts"
import type { RecoveryRecord } from "../lib/operation-recovery-types.ts"
import {
  CONVERSION_CONFIRM, effectiveInvoiceSeries, proformaConversionAvailability, proformaConversionOutcomeOf,
  proformaConversionSummary, type ProformaConversionOutcome, type ProformaConversionTarget,
} from "../lib/proforma-conversion.ts"
import type { ConversionOutcome } from "../lib/proforma-conversion-types.ts"
import type { Proforma } from "../lib/proforma-models.ts"

export interface ProformaConversionModel {
  readonly outcome: ProformaConversionOutcome
  readonly seriesOptions: ReadonlyArray<string>
  readonly selectedSeries: string
  readonly selectSeries: (series: string) => void
  /** The catalogue answered and holds no invoice series: a setup note, not a failure. */
  readonly seriesMissing: boolean
  readonly pending: boolean
  readonly error: unknown
  readonly canIssueInvoice: boolean
  readonly canCreateDraft: boolean
  readonly dueDateIssue: string | null
  readonly unconfirmedMessage: string | undefined
  /** The server settled the conversion as a state of the document: it had already happened. */
  readonly alreadyConverted: string | undefined
  readonly notice: RecoveryNoticeModel | undefined
  readonly noticePending: boolean
  readonly replay: (record: RecoveryRecord) => void
  readonly dismiss: () => void
  readonly issueInvoice: () => void
  readonly createDraft: () => void
}

const knownWrite = (outcome: ConversionOutcome | undefined): KnownWrite | undefined => {
  if (outcome === undefined || outcome.kind !== "converted" || outcome.effectsError === undefined) return undefined
  const { result } = outcome
  return result.kind === "invoice"
    ? { kind: "invoice", id: result.invoice.id, effectsError: outcome.effectsError }
    : { kind: "draft", id: result.draft.id, effectsError: outcome.effectsError }
}

/**
 * The conversion half of the proforma screen: the invoice series to convert
 * under, the confirm dialog, and what the buttons are allowed to do — the
 * request itself and its effects live in the controller hook, behind the same
 * journal and ownership checks, so an answer arriving after logout or unmount
 * changes nothing.
 *
 * The document itself is passed in rather than read again here: the conversion
 * is derived from the same answer the screen is rendering, so the buttons can
 * never describe a state the snapshot above them contradicts.
 */
export const useProformaConversion = (proforma: Proforma | undefined): ProformaConversionModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const recovery = useAuthoringRecovery()
  const controller = useProformaConversionController(recovery.port)
  const [selected, setSelected] = useState("")

  // The catalogue is only read while a conversion is still possible: a proforma
  // that already became a document offers a link, not a series.
  const outcome = proformaConversionOutcomeOf(proforma)
  const series = useQuery({
    queryKey: ["document-series"],
    enabled: auth.status === "authenticated" && outcome.kind === "available",
    queryFn: ({ signal }) => clients.reference.listDocumentSeries(signal),
  })
  const seriesOptions = authoringSeriesOptions(series.data ?? [], "invoice")
  const selectedSeries = effectiveInvoiceSeries(seriesOptions, selected)
  const mutation = useMutation({
    mutationFn: (target: ProformaConversionTarget): Promise<ConversionOutcome> => (proforma === undefined
      ? Promise.reject(new Error("Proforma nu este încărcată."))
      : controller.convert({
        target, proformaId: proforma.id, invoiceSeries: selectedSeries,
        summary: proformaConversionSummary(proforma, selectedSeries),
        // The document's own terms travel with the request: the rule about a
        // positive total without a due date is the controller's to apply, not
        // this screen's to remember.
        dueDate: proforma.dueDate, totalIncludingVat: proforma.totalIncludingVat,
        // The real reason writing is closed, not a placeholder: an unresolved
        // journal entry refuses the request where it is sent.
        blockedMessage: recovery.notice?.message,
      })),
  })
  const known = knownWrite(mutation.data)
  const alreadyConverted = mutation.data?.kind === "already-converted" ? mutation.data.message : undefined
  const availability = proformaConversionAvailability({
    proforma, selectedSeries, pending: mutation.isPending,
    blocked: recovery.blocked || known !== undefined || alreadyConverted !== undefined,
  })
  const failure = mutation.data === undefined
    ? null
    : mutation.data.kind === "error"
      ? mutation.data.error
      : mutation.data.kind === "converted" ? mutation.data.effectsError ?? null : null
  const convert = (target: ProformaConversionTarget): void => {
    if (target === "invoice" ? !availability.canIssueInvoice : !availability.canCreateDraft) return
    if (target === "draft" || window.confirm(CONVERSION_CONFIRM)) mutation.mutate(target)
  }
  return {
    ...availability,
    seriesOptions,
    selectedSeries,
    selectSeries: setSelected,
    seriesMissing: outcome.kind === "available" && !series.isPending && seriesOptions.length === 0,
    pending: mutation.isPending,
    error: failure ?? mutation.error ?? series.error ?? recovery.error,
    unconfirmedMessage: controller.unconfirmedConversion(),
    alreadyConverted,
    notice: recovery.notice ?? knownResultNotice(known),
    noticePending: recovery.pending,
    replay: recovery.replay,
    dismiss: () => { mutation.reset(); recovery.dismiss() },
    issueInvoice: () => { convert("invoice") },
    createDraft: () => { convert("draft") },
  }
}
