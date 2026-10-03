"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { registryWriteOutcome } from "../lib/registry-write-outcome.ts"
import { requireCsrf } from "../lib/require-csrf.ts"
import {
  ISSUER_SAVED, ISSUER_SAVED_WHILE_EDITING, savedFormReplacesEdits,
} from "../lib/settings-revisions.ts"
import type { Issuer } from "../lib/draft-models.ts"
import type { IssuerInput } from "../lib/settings-client.ts"
import type { RevisionGuard } from "../lib/revision-guard.ts"

/**
 * The issuer `PUT`, and what its answer is allowed to change.
 *
 * Three filters sit between the request and the screen, and each answers a
 * different question. The CSRF token asks whether the session can sign at all.
 * The epoch asks whether the answer still belongs to the session that asked —
 * the rule is `registry-write-outcome.ts`, shared with the master-data writes.
 * The revision asks whether the form may be replaced by what came back: it may
 * not, if the user kept typing, and the notice says so instead of the save
 * silently discarding those edits.
 *
 * The answer is written into the cache before the invalidation, so the screen
 * shows the saved profile immediately and the refetch only confirms it.
 */
interface IssuerSaveRequest {
  readonly payload: IssuerInput
  /** The form revision read before the request left. */
  readonly revision: number
}

export interface IssuerSaveModel {
  readonly pending: boolean
  readonly error: unknown
  readonly notice: string | undefined
  readonly save: (payload: IssuerInput, revision: number) => void
  readonly dismissNotice: () => void
}

export const useIssuerSave = (guard: RevisionGuard, onReplaced: () => void): IssuerSaveModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const mutation = useMutation({
    mutationFn: async (request: IssuerSaveRequest) => {
      const csrfToken = requireCsrf(auth.csrfToken())
      const epoch = auth.epoch()
      let saved: Issuer | undefined
      const owned = await registryWriteOutcome(
        request,
        async () => { saved = await clients.settings.saveIssuer(csrfToken, request.payload) },
        () => auth.ownsEpoch(epoch),
      )
      return owned === undefined || saved === undefined ? undefined : { saved, revision: owned.revision }
    },
    onSuccess: (answer) => {
      if (answer === undefined) return
      queryClient.setQueryData(["issuer"], answer.saved)
      void queryClient.invalidateQueries({ queryKey: ["issuer"] })
      const replaces = savedFormReplacesEdits(guard, answer.revision)
      if (replaces) onReplaced()
      setNotice(replaces ? ISSUER_SAVED : ISSUER_SAVED_WHILE_EDITING)
    },
  })
  return {
    pending: mutation.isPending,
    error: mutation.error,
    notice,
    save: (payload, revision) => { setNotice(undefined); mutation.mutate({ payload, revision }) },
    dismissNotice: () => { setNotice(undefined) },
  }
}
