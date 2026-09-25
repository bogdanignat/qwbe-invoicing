"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { draftsQueryKey, draftQueryKey } from "./use-drafts.ts"
import { invoiceRegisterQueryKey } from "./use-invoice-register.ts"
import { staleProformaKeys } from "./proforma-query-keys.ts"
import { lifetimeMountEffect, lifetimeRequestsEffect } from "../lib/authoring-lifetime-wiring.ts"
import { createOperationLifetime } from "../lib/authoring-operation-lifetime.ts"
import type { RecoveryPort } from "../lib/operation-recovery-port.ts"
import { createProformaConversionController } from "../lib/proforma-conversion-controller.ts"
import type { ProformaConversionController } from "../lib/proforma-conversion-types.ts"

/**
 * The conversion controller and the effects that follow a converted document
 * into existence, kept apart from the screen's model: the wiring is what has to
 * survive re-renders, the model is what is recomputed on each one.
 *
 * One instance for the whole lifetime of the screen — its single-flight flag and
 * any attempt with an unknown outcome live in it — and the proforma is named per
 * request rather than captured, so the same controller serves whichever proforma
 * the screen is showing.
 */
export const useProformaConversionController = (recovery: RecoveryPort): ProformaConversionController => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [lifetime] = useState(createOperationLifetime)
  useEffect(() => lifetimeMountEffect(lifetime), [lifetime])
  useEffect(() => lifetimeRequestsEffect(lifetime), [lifetime, auth.status])
  const staleProformas = (proformaId: string): void => {
    for (const queryKey of staleProformaKeys(proformaId)) void queryClient.invalidateQueries({ queryKey })
  }
  /**
   * Everything a conversion could have produced, re-read: the proforma itself,
   * so the screen stops offering a conversion that already happened, and both
   * registries, because the document it became is listed in one of them. It is
   * the same refresh whether the answer was lost or the server said the
   * conversion had already been made — in both cases the screen is out of date,
   * not the server.
   */
  const refreshConverted = (proformaId: string): void => {
    staleProformas(proformaId)
    void queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })
    void queryClient.invalidateQueries({ queryKey: draftsQueryKey })
  }
  const [controller] = useState<ProformaConversionController>(() => createProformaConversionController({
    client: {
      convertToInvoice: (csrfToken, proformaId, invoiceSeries, key) =>
        clients.proformas.convertToInvoice(csrfToken, proformaId, { invoiceSeries }, key),
      convertToDraft: (csrfToken, proformaId, invoiceSeries, key) =>
        clients.proformas.convertToDraft(csrfToken, proformaId, { invoiceSeries }, key),
      replayInvoiceFromProforma: (csrfToken, proformaId, body, key) =>
        clients.proformaReplay.replayInvoiceFromProforma(csrfToken, proformaId, body, key),
      replayDraftFromProforma: (csrfToken, proformaId, body, key) =>
        clients.proformaReplay.replayDraftFromProforma(csrfToken, proformaId, body, key),
    },
    recovery,
    csrfToken: auth.csrfToken,
    epoch: auth.epoch,
    ownsEpoch: auth.ownsEpoch,
    alive: () => lifetime.isAlive(),
    effects: {
      onConverted: (result, proformaId) => {
        staleProformas(proformaId)
        void queryClient.invalidateQueries({ queryKey: draftsQueryKey })
        if (result.kind === "invoice") {
          void queryClient.invalidateQueries({ queryKey: invoiceRegisterQueryKey })
          router.push(`/invoices/${encodeURIComponent(result.invoice.id)}`)
          return
        }
        // The draft is the answer the server just gave: it is put in the cache so
        // the screen it opens does not read it again.
        queryClient.setQueryData(draftQueryKey(result.draft.id), result.draft)
        router.push(`/drafts/${encodeURIComponent(result.draft.id)}`)
      },
      // The document may already exist: the outcome can then be looked up by hand.
      onOutcomeUnknown: refreshConverted,
      // Not in doubt at all — the server named the refusal — so the re-read is
      // what turns the section into the link to the resulting document.
      onAlreadyConverted: refreshConverted,
    },
  }))
  return controller
}
