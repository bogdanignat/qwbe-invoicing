"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { proformasQueryKey } from "./proforma-query-keys.ts"
import { lifetimeMountEffect, lifetimeRequestsEffect } from "../lib/authoring-lifetime-wiring.ts"
import { createOperationLifetime } from "../lib/authoring-operation-lifetime.ts"
import { issuanceAllowed } from "../lib/invoice-authoring-derived.ts"
import type { KnownWrite } from "../lib/operation-recovery-view.ts"
import type { RecoveryPort } from "../lib/operation-recovery-port.ts"
import type { AuthoringProformaInput } from "../lib/proforma-models.ts"
import { createProformaSaveController } from "../lib/proforma-save-controller.ts"
import type { ProformaSaveController, ProformaSaveOutcome } from "../lib/proforma-save-types.ts"

export const PROFORMA_SAVE_CONFIRM = "Salvezi proforma? Va primi un număr și va deveni un document comercial imuabil, nefiscal."

interface ProformaSaveInput {
  readonly payload: AuthoringProformaInput
  readonly canSave: boolean
  /** An unresolved entry in the journal, or a result already known: the controller refuses before any request. */
  readonly blockedMessage: string | undefined
  readonly blocked: boolean
  readonly recovery: RecoveryPort
}

export interface ProformaSaveModel {
  readonly pending: boolean
  readonly error: unknown
  /** The proforma exists but the screen could not follow it: named here so nothing is authored twice. */
  readonly knownResult: KnownWrite | undefined
  readonly canSave: boolean
  readonly unconfirmedMessage: string | undefined
  readonly save: () => void
  /** Acknowledges a known result: the screen drops the outcome it could not follow and opens up again. */
  readonly reset: () => void
}

/**
 * The save wiring around the pure proforma controller: the confirm dialog and
 * the effects after it (the registry invalidation, the move to the new
 * proforma) all run through the controller's ownership checks, so an answer
 * that arrives after logout or unmount changes nothing.
 *
 * The controller is one instance for the whole lifetime of the screen — its
 * single-flight flag and any attempt with an unknown outcome must survive
 * re-renders — and the payload travels per request, so nothing is captured.
 */
export const useProformaSave = (input: ProformaSaveInput): ProformaSaveModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [lifetime] = useState(createOperationLifetime)
  useEffect(() => lifetimeMountEffect(lifetime), [lifetime])
  useEffect(() => lifetimeRequestsEffect(lifetime), [lifetime, auth.status])
  const [controller] = useState<ProformaSaveController>(() => createProformaSaveController({
    client: {
      createProforma: (csrfToken, body, key) => clients.proformas.createProforma(csrfToken, body, key),
      replayProformaIssuance: (csrfToken, body, key) => clients.proformaReplay.replayProformaIssuance(csrfToken, body, key),
    },
    recovery: input.recovery,
    csrfToken: auth.csrfToken,
    epoch: auth.epoch,
    ownsEpoch: auth.ownsEpoch,
    alive: () => lifetime.isAlive(),
    effects: {
      onSaved: (proforma) => {
        void queryClient.invalidateQueries({ queryKey: proformasQueryKey })
        router.push(`/proformas/${encodeURIComponent(proforma.id)}`)
      },
      onOutcomeUnknown: () => {
        // The proforma may already exist: the registry is refreshed so the
        // outcome can be looked up instead of trusting a lost answer.
        void queryClient.invalidateQueries({ queryKey: proformasQueryKey })
      },
    },
  }))

  const mutation = useMutation({
    mutationFn: (): Promise<ProformaSaveOutcome> => controller.save({
      payload: input.payload, blockedMessage: input.blockedMessage,
    }),
  })
  const outcome = mutation.data
  // Saved, but the navigation or the cache write after it failed. The proforma
  // is real and named; saving again from this same screen would author a second
  // one under a fresh key, so the button stays closed until the user follows the
  // link the notice shows.
  const knownResult: KnownWrite | undefined = outcome !== undefined && outcome.kind === "saved" && outcome.effectsError !== undefined
    ? { kind: "proforma", id: outcome.proforma.id, effectsError: outcome.effectsError }
    : undefined
  const canSave = issuanceAllowed({
    requested: input.canSave && !input.blocked, workflowPending: false,
    issuePending: mutation.isPending, knownResult,
  })
  // `mutation.error` is the throw the controller never caught — a missing CSRF
  // token, a programming fault — and it has to reach the screen too, or a save
  // that never left looks like nothing happened.
  const outcomeError = outcome === undefined
    ? null
    : outcome.kind === "error" ? outcome.error : (outcome.kind === "saved" ? outcome.effectsError ?? null : null)
  return {
    pending: mutation.isPending,
    error: outcomeError ?? mutation.error,
    knownResult,
    canSave,
    unconfirmedMessage: controller.unconfirmedSave(),
    save: () => {
      if (!canSave) return
      if (window.confirm(PROFORMA_SAVE_CONFIRM)) mutation.mutate()
    },
    reset: () => { mutation.reset() },
  }
}
