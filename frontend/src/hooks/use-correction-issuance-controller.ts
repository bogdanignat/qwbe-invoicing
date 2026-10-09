"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { invoiceRegisterQueryKey } from "./use-invoice-register.ts"
import { lifetimeMountEffect, lifetimeRequestsEffect } from "../lib/authoring-lifetime-wiring.ts"
import { createOperationLifetime } from "../lib/authoring-operation-lifetime.ts"
import { createCorrectionIssuanceController } from "../lib/correction-issuance-controller.ts"
import type { CorrectionIssuanceController } from "../lib/correction-issuance-types.ts"
import type { RecoveryPort } from "../lib/operation-recovery-port.ts"

/**
 * The storno controller and the effects that follow a storno into existence,
 * kept apart from the section's model: the wiring has to survive re-renders,
 * the model is recomputed on each one.
 *
 * One instance for the whole lifetime of the screen — its single-flight flag and
 * any attempt with an unknown outcome live in it — and the invoice is named per
 * request rather than captured.
 */
export const useCorrectionIssuanceController = (recovery: RecoveryPort): CorrectionIssuanceController => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [lifetime] = useState(createOperationLifetime)
  useEffect(() => lifetimeMountEffect(lifetime), [lifetime])
  useEffect(() => lifetimeRequestsEffect(lifetime), [lifetime, auth.status])
  /**
   * The invoice and everything under its key — the detail, the payments and the
   * corrections — re-read, and the register that lists the storno. The same
   * refresh whether the answer was lost or the server said the storno exists.
   */
  const refreshInvoice = (invoiceId: string): void => {
    void queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] })
    void queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })
  }
  const [controller] = useState<CorrectionIssuanceController>(() => createCorrectionIssuanceController({
    client: {
      createCorrection: (csrfToken, invoiceId, body, key) => clients.documents.createCorrection(csrfToken, invoiceId, body, key),
      replayCorrection: (csrfToken, invoiceId, body, key) => clients.documents.replayCorrection(csrfToken, invoiceId, body, key),
    },
    recovery,
    csrfToken: auth.csrfToken,
    epoch: auth.epoch,
    ownsEpoch: auth.ownsEpoch,
    alive: () => lifetime.isAlive(),
    effects: {
      onIssued: (correction, invoiceId) => {
        // The storno is the answer the server just gave: cached so its screen does not read it again.
        queryClient.setQueryData(["correction", correction.id], correction)
        refreshInvoice(invoiceId)
        router.push(`/corrections/${encodeURIComponent(correction.id)}`)
      },
      onOutcomeUnknown: refreshInvoice,
      onAlreadyCorrected: refreshInvoice,
    },
  }))
  return controller
}
