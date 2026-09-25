"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { draftsQueryKey, draftQueryKey } from "./use-drafts.ts"
import { invoiceRegisterQueryKey } from "./use-invoice-register.ts"
import { createOperationLifetime } from "../lib/authoring-operation-lifetime.ts"
import { lifetimeMountEffect, lifetimeRequestsEffect } from "../lib/authoring-lifetime-wiring.ts"
import { createOperationReplay, replayKnownResult, type OperationReplay, type ReplayOutcome } from "../lib/operation-replay.ts"
import type { KnownWrite } from "../lib/operation-recovery-view.ts"
import type { RecoveryPort } from "../lib/operation-recovery-port.ts"
import type { RecoveryRecord } from "../lib/operation-recovery-types.ts"
import { requireCsrf } from "../lib/require-csrf.ts"

export interface OperationReplayModel {
  readonly pending: boolean
  readonly error: unknown
  /** A confirmed write whose follow-up on the screen failed: the document exists and must not be written again. */
  readonly result: KnownWrite | undefined
  readonly replay: (record: RecoveryRecord) => void
  readonly reset: () => void
}

const UNKNOWN_AGAIN = "Răspunsul lipsește din nou. Cererea rămâne salvată sub aceeași cheie: verifică registrul de facturi sau încearcă mai târziu."

/** The React side of an explicit replay: the user's button, the stored request, the server's answer adopted as it comes back. */
export const useOperationReplay = (recovery: RecoveryPort): OperationReplayModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [lifetime] = useState(createOperationLifetime)
  useEffect(() => lifetimeMountEffect(lifetime), [lifetime])
  useEffect(() => lifetimeRequestsEffect(lifetime), [lifetime, auth.status])
  const [controller] = useState<OperationReplay>(() => createOperationReplay({
    client: {
      replayDraftCreation: (csrfToken, body, key) => clients.drafts.replayDraftCreation(csrfToken, body, key),
      issueDraft: (csrfToken, id, key) => clients.drafts.issueDraft(csrfToken, id, key),
      replayInvoiceIssuance: (csrfToken, body, key) => clients.drafts.replayInvoiceIssuance(csrfToken, body, key),
    },
    recovery,
    csrfToken: () => requireCsrf(auth.csrfToken()),
    epoch: auth.epoch,
    ownsEpoch: auth.ownsEpoch,
    alive: () => lifetime.isAlive(),
    effects: {
      onDraft: (draft) => {
        queryClient.setQueryData(draftQueryKey(draft.id), draft)
        void queryClient.invalidateQueries({ queryKey: draftsQueryKey })
        router.replace(`/drafts/${encodeURIComponent(draft.id)}`)
      },
      onIssued: (invoice) => {
        void queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })
        void queryClient.invalidateQueries({ queryKey: draftsQueryKey })
        router.push(`/invoices/${encodeURIComponent(invoice.id)}`)
      },
    },
  }))

  const mutation = useMutation({
    mutationFn: (record: RecoveryRecord): Promise<ReplayOutcome> => controller.replay(record),
  })
  const outcome = mutation.data
  const failure = outcome === undefined || outcome.kind === "draft" || outcome.kind === "issued" || outcome.kind === "aborted"
    ? null
    : outcome.kind === "unknown" ? new Error(UNKNOWN_AGAIN) : outcome.error
  return {
    pending: mutation.isPending,
    error: failure ?? mutation.error,
    result: replayKnownResult(outcome),
    replay: (record) => { mutation.mutate(record) },
    reset: () => { mutation.reset() },
  }
}
