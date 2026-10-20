import { useMutation, useQuery } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { efacturaCandidatesQuery } from "./efactura-queries.ts"
import { SESSION_CLOSED } from "./use-registry-writes.ts"
import type { EFacturaClient } from "../lib/efactura-client.ts"
import { efacturaFailure } from "../lib/efactura-feedback.ts"
import { candidatesView, linkConfirm, RESUBMIT_CONFIRM, type CandidatesView } from "../lib/efactura-history.ts"
import type { EFacturaSubmission } from "../lib/efactura-submissions.ts"
import { sessionWrite } from "../lib/session-write.ts"

export interface EFacturaReconciliationModel {
  readonly searched: boolean
  readonly candidates: CandidatesView | undefined
  readonly searching: boolean
  readonly searchError: Error | undefined
  readonly search: () => void
  readonly goTo: (page: number) => void
  readonly pending: boolean
  readonly failure: Error | undefined
  readonly link: (uploadIndex: string) => void
  readonly resubmit: () => void
}

/**
 * Reconciling an `unknown` submission: ANAF's list is asked only when the user
 * presses „Caută la ANAF”, one page at a time; „Leagă” and „Retrimite” each
 * need the user's explicit confirmation, which is what the request carries as
 * `confirmed: true`. Any answer calls `onMoved`, which refreshes the document:
 * a success moved the submission, and a refusal (`efactura_not_unknown`) says
 * it moved already. `submissionId` is the current unknown one, or `undefined`
 * when there is nothing to reconcile.
 */
export const useEFacturaReconciliation = (
  client: EFacturaClient, submissionId: string | undefined, onMoved: () => void,
): EFacturaReconciliationModel => {
  const auth = useAuth()
  const [search, setSearch] = useState<{ readonly id: string; readonly page: number } | undefined>(undefined)
  const asked = search !== undefined && search.id === submissionId ? search : undefined
  const read = useQuery(efacturaCandidatesQuery(client, asked?.id, asked?.page ?? 1))
  const inFlight = useRef(false)
  const write = useMutation({
    mutationFn: async (send: (token: string) => Promise<EFacturaSubmission>) =>
      (await sessionWrite(auth, send, SESSION_CLOSED))?.value,
    onSuccess: (moved) => { if (moved !== undefined) { setSearch(undefined); onMoved() } },
    onError: onMoved,
    onSettled: () => { inFlight.current = false },
  })
  const start = (send: (token: string) => Promise<EFacturaSubmission>): void => {
    inFlight.current = true
    write.mutate(send)
  }
  const data = asked === undefined ? undefined : read.data
  return {
    searched: asked !== undefined,
    candidates: data === undefined ? undefined : candidatesView(data),
    searching: asked !== undefined && read.isFetching,
    searchError: asked === undefined ? undefined : efacturaFailure(read.error),
    search: () => {
      if (submissionId === undefined) return
      if (asked === undefined) { setSearch({ id: submissionId, page: 1 }); return }
      void read.refetch()
    },
    goTo: (page) => { if (submissionId !== undefined) setSearch({ id: submissionId, page }) },
    pending: write.isPending,
    failure: efacturaFailure(write.error),
    link: (uploadIndex) => {
      if (submissionId === undefined || inFlight.current || !window.confirm(linkConfirm(uploadIndex))) return
      start((token) => client.link(token, submissionId, uploadIndex))
    },
    resubmit: () => {
      if (submissionId === undefined || inFlight.current || !window.confirm(RESUBMIT_CONFIRM)) return
      start((token) => client.resubmit(token, submissionId))
    },
  }
}
