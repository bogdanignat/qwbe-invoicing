import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { invoiceRegisterQueryKey } from "./use-invoice-register.ts"
import { draftsQueryKey, draftQueryKey } from "./use-drafts.ts"
import { createOperationLifetime } from "../lib/authoring-operation-lifetime.ts"
import { lifetimeMountEffect, lifetimeRequestsEffect } from "../lib/authoring-lifetime-wiring.ts"
import { issuanceAllowed } from "../lib/invoice-authoring-derived.ts"
import { createInvoiceIssuanceController } from "../lib/invoice-issuance-controller.ts"
import type { InvoiceIssuanceController, IssuanceOutcome } from "../lib/invoice-issuance-types.ts"
import type { AuthoringDocumentInput } from "../lib/draft-models.ts"
import type { RecoveryPort } from "../lib/operation-recovery-port.ts"
import type { KnownWrite } from "../lib/operation-recovery-view.ts"

interface InvoiceIssuanceInput {
  readonly draftId: string | undefined
  readonly payload: AuthoringDocumentInput
  readonly canIssue: boolean
  readonly workflowPending: boolean
  /** A save whose outcome is unknown blocks issuance: the controller refuses it before any request. */
  readonly blockedMessage: string | undefined
  readonly recovery: RecoveryPort
}

export interface InvoiceIssuanceModel {
  readonly pending: boolean
  readonly error: unknown
  /** The invoice exists but the screen could not follow it: named here so nothing is issued twice. */
  readonly knownResult: KnownWrite | undefined
  readonly canIssue: boolean
  readonly unconfirmedMessage: string | undefined
  readonly issue: () => void
  /** Acknowledges a known result: the screen drops the outcome it could not follow and opens up again. */
  readonly reset: () => void
}

/**
 * The issuance wiring around the pure issuance controller: the confirm dialog
 * and the post-success effects (cache invalidation, the move to the issued
 * invoice, the eviction of the draft's cache entry) all run through the
 * controller's ownership checks, so an answer that arrives after logout or
 * unmount changes nothing.
 *
 * The controller is one instance for the whole lifetime of the screen: its
 * single-flight flag and any attempt with an unknown outcome must survive
 * re-renders (the auth context hands out a fresh object every render, so a
 * `useMemo` keyed on it would rebuild the controller and lose them). The
 * session's handles are stable for the same lifetime, and the ownership
 * checks — not controller rebuilds — decide what a new session may do.
 */
export const useInvoiceIssuance = (input: InvoiceIssuanceInput): InvoiceIssuanceModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const router = useRouter()
  // The reconciliation read is tracked: its request dies with the screen or
  // the session (a status change is a session boundary), instead of wandering
  // off with a signal nobody can abort. Re-authentication gets a fresh one,
  // while the mount axis stays untouched — a new session's rights are decided
  // by the epoch checks in the controller, not by this lifetime.
  const [lifetime] = useState(createOperationLifetime)
  useEffect(() => lifetimeMountEffect(lifetime), [lifetime])
  useEffect(() => lifetimeRequestsEffect(lifetime), [lifetime, auth.status])
  const [controller] = useState<InvoiceIssuanceController>(() => createInvoiceIssuanceController({
    client: {
      getDraft: (id) => clients.drafts.getDraft(id, lifetime.signal()),
      issueDraft: (csrfToken, id, idempotencyKey) => clients.drafts.issueDraft(csrfToken, id, idempotencyKey),
      issueInvoice: (csrfToken, body, idempotencyKey) => clients.drafts.issueInvoice(csrfToken, body, idempotencyKey),
      replayInvoiceIssuance: (csrfToken, body, key) => clients.drafts.replayInvoiceIssuance(csrfToken, body, key),
    },
    recovery: input.recovery,
    csrfToken: auth.csrfToken,
    epoch: auth.epoch,
    ownsEpoch: auth.ownsEpoch,
    alive: () => lifetime.isAlive(),
    effects: {
      onIssued: (invoice, draftId) => {
        router.push(`/invoices/${encodeURIComponent(invoice.id)}`)
        // The draft is gone as a draft: its cache entry is dropped now, not on
        // a timer nobody owns and an unmount would leave running.
        if (draftId !== undefined) {
          queryClient.removeQueries({ queryKey: draftQueryKey(draftId), exact: true })
        }
        void queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })
        void queryClient.invalidateQueries({ queryKey: draftsQueryKey })
        void queryClient.invalidateQueries({ queryKey: ["invoice", invoice.id] })
      },
      onOutcomeUnknown: (draftId) => {
        // The invoice may already exist: the registries are refreshed so the
        // user can check the outcome instead of trusting a lost answer.
        void queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })
        void queryClient.invalidateQueries({ queryKey: draftsQueryKey })
        if (draftId !== undefined) {
          void queryClient.invalidateQueries({ queryKey: draftQueryKey(draftId) })
        }
      },
    },
  }))

  const mutation = useMutation({
    mutationFn: (): Promise<IssuanceOutcome> => controller.issue({
      draftId: input.draftId, payload: input.payload, blockedMessage: input.blockedMessage,
    }),
  })
  const unconfirmedMessage = controller.unconfirmedIssue()
  const outcome = mutation.data
  // Issued, but the navigation or the cache write after it failed. The invoice
  // is real and named; issuing again from this same screen would seal a second
  // one under a fresh key, so the button stays closed until the user follows
  // the link the notice shows.
  const knownResult: KnownWrite | undefined = outcome !== undefined && outcome.kind === "issued" && outcome.effectsError !== undefined
    ? { kind: "invoice", id: outcome.invoice.id, effectsError: outcome.effectsError }
    : undefined
  const canIssue = issuanceAllowed({
    requested: input.canIssue, workflowPending: input.workflowPending,
    issuePending: mutation.isPending, knownResult,
  })
  // `mutation.error` is the throw the controller never caught — a missing CSRF
  // token, a programming fault — and it has to reach the screen too, or an
  // issuance that never left looks like nothing happened.
  const outcomeError = outcome === undefined
    ? null
    : outcome.kind === "error" ? outcome.error : (outcome.kind === "issued" ? outcome.effectsError ?? null : null)
  return {
    pending: mutation.isPending,
    error: outcomeError ?? mutation.error,
    knownResult,
    canIssue,
    unconfirmedMessage,
    issue: () => {
      if (!canIssue) return
      if (window.confirm("Emiți factura? Numărul și documentul fiscal devin imuabile.")) mutation.mutate()
    },
    reset: () => { mutation.reset() },
  }
}
