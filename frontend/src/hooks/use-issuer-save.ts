import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { referenceQueryKeys } from "./reference-queries.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { sessionWrite } from "../lib/session-write.ts"
import { savedFormReplacesEdits } from "../lib/settings-revisions.ts"
import { issuerSaveError, issuerSaveNotes, NO_SAVE_NOTES, type IssuerSaveEvent } from "../lib/issuer-save-notes.ts"
import { UnreadableAnswer } from "../lib/unreadable-answer.ts"
import type { IssuerInput } from "../lib/settings-client.ts"
import type { RevisionGuard } from "../lib/revision-guard.ts"

/**
 * The issuer `PUT`, and what its answer is allowed to change.
 *
 * Three filters sit between the request and the screen, and each answers a
 * different question. The CSRF token asks whether the session can sign at all.
 * The epoch asks whether the answer still belongs to the session that asked —
 * both are `session-write.ts`, shared with the master-data writes.
 * The revision asks whether the form may be replaced by what came back: it may
 * not, if the user kept typing, and the notice says so instead of the save
 * silently discarding those edits.
 *
 * The answer is written into the cache before the invalidation, so the screen
 * shows the saved profile immediately and the refetch only confirms it. A save
 * that went through unchecked by ANAF says so in `warning`, next to the notice
 * (`issuer-save-notes.ts`). An answer that arrived unreadable may be a saved
 * profile, so the issuer is read again instead of trusting the cache, and the
 * form follows it unless the user kept typing.
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
  readonly warning: string | undefined
  readonly save: (payload: IssuerInput, revision: number) => void
  readonly dismissNotice: () => void
}

export const useIssuerSave = (guard: RevisionGuard, onReplaced: () => void): IssuerSaveModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const [notes, setNotes] = useState(NO_SAVE_NOTES)
  const note = (event: IssuerSaveEvent) => { setNotes(issuerSaveNotes(event)) }
  const mutation = useMutation({
    mutationFn: async (request: IssuerSaveRequest) => {
      const answer = await sessionWrite(auth, (csrfToken) => clients.settings.saveIssuer(csrfToken, request.payload))
      return answer === undefined ? undefined : { saved: answer.value, revision: request.revision }
    },
    onSuccess: (answer) => {
      if (answer === undefined) return
      queryClient.setQueryData(referenceQueryKeys.issuer, answer.saved.issuer)
      void queryClient.invalidateQueries({ queryKey: referenceQueryKeys.issuer })
      const replacesEdits = savedFormReplacesEdits(guard, answer.revision)
      if (replacesEdits) onReplaced()
      note({ kind: "saved", replacesEdits, warnings: answer.saved.warnings })
    },
    onError: (error, request) => {
      note({ kind: "failed" })
      if (!(error instanceof UnreadableAnswer)) return
      void queryClient.invalidateQueries({ queryKey: referenceQueryKeys.issuer })
      if (savedFormReplacesEdits(guard, request.revision)) onReplaced()
    },
  })
  return {
    pending: mutation.isPending,
    error: issuerSaveError(mutation.error),
    ...notes,
    save: (payload, revision) => { note({ kind: "sent" }); mutation.mutate({ payload, revision }) },
    dismissNotice: () => { note({ kind: "dismissed" }) },
  }
}
