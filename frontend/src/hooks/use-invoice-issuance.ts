import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { invoiceRegisterQueryKey } from "./use-invoice-register.ts"
import { draftsQueryKey, draftQueryKey } from "./use-drafts.ts"
import { useOperationIdempotency } from "./use-operation-idempotency.ts"
import { createOperationLifetime } from "../lib/authoring-operation-lifetime.ts"
import { createInvoiceIssuanceController, type InvoiceIssuanceController, type IssuanceOutcome } from "../lib/invoice-issuance-controller.ts"
import type { AuthoringDocumentInput } from "../lib/draft-models.ts"

interface InvoiceIssuanceInput {
  readonly draftId: string | undefined
  readonly payload: AuthoringDocumentInput
  readonly canIssue: boolean
  readonly workflowPending: boolean
  /** A save whose outcome is unknown blocks issuance: the controller refuses it before any request. */
  readonly blockedMessage: string | undefined
}

export interface InvoiceIssuanceModel {
  readonly pending: boolean
  readonly error: unknown
  readonly canIssue: boolean
  readonly unconfirmedMessage: string | undefined
  readonly issue: () => void
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
  const idempotency = useOperationIdempotency()
  // The reconciliation read is tracked: its request dies with the screen or
  // the session (a status change is a session boundary), instead of wandering
  // off with a signal nobody can abort. Re-authentication gets a fresh one,
  // while the mount axis stays untouched — a new session's rights are decided
  // by the epoch checks in the controller, not by this lifetime.
  const [lifetime] = useState(createOperationLifetime)
  useEffect(() => {
    lifetime.activate()
    return () => { lifetime.deactivate() }
  }, [lifetime])
  useEffect(() => {
    const generation = lifetime.beginRequests()
    return () => { lifetime.endRequests(generation) }
  }, [lifetime, auth.status])
  const [controller] = useState<InvoiceIssuanceController>(() => createInvoiceIssuanceController({
    client: {
      getDraft: (id) => clients.drafts.getDraft(id, lifetime.signal()),
      issueDraft: (csrfToken, id, idempotencyKey) => clients.drafts.issueDraft(csrfToken, id, idempotencyKey),
      issueInvoice: (csrfToken, body, idempotencyKey) => clients.drafts.issueInvoice(csrfToken, body, idempotencyKey),
    },
    idempotency,
    csrfToken: auth.csrfToken,
    epoch: auth.epoch,
    ownsEpoch: auth.ownsEpoch,
    alive: () => lifetime.isAlive(),
    effects: {
      onIssued: (invoice, draftId) => {
        router.push(`/invoices/${encodeURIComponent(invoice.id)}`)
        if (draftId !== undefined) {
          window.setTimeout(() => { queryClient.removeQueries({ queryKey: draftQueryKey(draftId), exact: true }) }, 0)
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
  const canIssue = input.canIssue && !input.workflowPending && !mutation.isPending
  return {
    pending: mutation.isPending,
    error: mutation.data !== undefined && mutation.data.kind === "error" ? mutation.data.error : null,
    canIssue,
    unconfirmedMessage,
    issue: () => {
      if (!canIssue) return
      if (window.confirm("Emiți factura? Numărul și documentul fiscal devin imuabile.")) mutation.mutate()
    },
  }
}
