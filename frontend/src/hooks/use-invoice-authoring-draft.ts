import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useState, type Dispatch, type SetStateAction } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { draftsQueryKey, draftQueryKey } from "./use-drafts.ts"
import { createOperationLifetime } from "../lib/authoring-operation-lifetime.ts"
import { lifetimeMountEffect, lifetimeRequestsEffect } from "../lib/authoring-lifetime-wiring.ts"
import { createInvoiceDraftSaveController, type InvoiceDraftSaveController } from "../lib/invoice-draft-save-controller.ts"
import type { SaveOutcome } from "../lib/draft-save-types.ts"
import type { DraftInvoice } from "../lib/draft-models.ts"
import type { EditableInvoiceLine, InvoiceAuthoringForm } from "../lib/invoice-authoring-model.ts"
import type { RecoveryPort } from "../lib/operation-recovery-port.ts"

interface AuthoringDraftInput {
  readonly initialDraft: DraftInvoice | undefined
  readonly form: InvoiceAuthoringForm
  readonly lines: ReadonlyArray<EditableInvoiceLine>
  readonly setLines: Dispatch<SetStateAction<ReadonlyArray<EditableInvoiceLine>>>
  readonly forcedUpdateLineIds: (draft: DraftInvoice) => ReadonlyArray<string>
  readonly recovery: RecoveryPort
}

export interface AuthoringDraftModel {
  readonly draft: DraftInvoice | undefined
  readonly pending: boolean
  readonly savePending: boolean
  readonly error: unknown
  readonly unconfirmedMessage: string | undefined
  readonly resumableSave: boolean
  readonly notice: string | null
  readonly save: () => void
  readonly deleteLine: (line: EditableInvoiceLine) => void
  readonly deleteDraft: () => void
}

/**
 * The save/delete wiring around the pure save controller.
 *
 * The controller owns the ordering, the reconciliation and the ownership
 * checks — before every chained write and after every answer — while this hook
 * owns React: it holds the draft state and routes the controller's effects
 * into state and cache.
 *
 * The controller is one instance for the whole lifetime of the screen: its
 * single-flight flags and any "outcome unknown" block must survive re-renders
 * (the auth context hands out a fresh object every render, so a `useMemo`
 * keyed on it would rebuild the controller and lose them). The session's
 * handles are stable for the same lifetime, and the ownership checks — not
 * controller rebuilds — decide what a new session may do.
 */
export const useInvoiceAuthoringDraft = (input: AuthoringDraftInput): AuthoringDraftModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const router = useRouter()
  const [draft, setDraft] = useState(input.initialDraft)
  const [notice, setNotice] = useState<string | null>(null)
  // The reconciliation read is tracked: its request dies with the screen or
  // the session (a status change is a session boundary), instead of wandering
  // off with a signal nobody can abort. Re-authentication gets a fresh one,
  // while the mount axis stays untouched — a new session's rights are decided
  // by the epoch checks in the controller, not by this lifetime.
  const [lifetime] = useState(createOperationLifetime)
  useEffect(() => lifetimeMountEffect(lifetime), [lifetime])
  useEffect(() => lifetimeRequestsEffect(lifetime), [lifetime, auth.status])
  const setLines = input.setLines
  const [controller] = useState<InvoiceDraftSaveController>(() => createInvoiceDraftSaveController({
    client: {
      createDraft: (csrfToken, body, key) => clients.drafts.createDraft(csrfToken, body, key),
      replayDraftCreation: (csrfToken, body, key) => clients.drafts.replayDraftCreation(csrfToken, body, key),
      getDraft: (id) => clients.drafts.getDraft(id, lifetime.signal()),
      updateDraft: (csrfToken, id, body) => clients.drafts.updateDraft(csrfToken, id, body),
      addDraftLine: (csrfToken, id, body) => clients.drafts.addDraftLine(csrfToken, id, body),
      updateDraftLine: (csrfToken, id, lineId, body) => clients.drafts.updateDraftLine(csrfToken, id, lineId, body),
      deleteDraftLine: (csrfToken, id, lineId) => clients.drafts.deleteDraftLine(csrfToken, id, lineId),
      deleteDraft: (csrfToken, id) => clients.drafts.deleteDraft(csrfToken, id),
    },
    csrfToken: auth.csrfToken,
    epoch: auth.epoch,
    ownsEpoch: auth.ownsEpoch,
    alive: () => lifetime.isAlive(),
    recovery: input.recovery,
    effects: {
      recordDraft: (updated) => {
        setDraft(updated)
        queryClient.setQueryData(draftQueryKey(updated.id), updated)
      },
      recordLines: (lines) => { setLines(lines) },
      removeLine: (lineKey) => { setLines((current) => current.filter((line) => line.key !== lineKey)) },
      invalidateDrafts: () => { void queryClient.invalidateQueries({ queryKey: draftsQueryKey }) },
      evictDraft: (id) => { queryClient.removeQueries({ queryKey: draftQueryKey(id), exact: true }) },
      notify: (message) => { setNotice(message) },
      navigate: (path) => { router.replace(path) },
    },
  }))

  const save = useMutation({ mutationFn: (request: Parameters<InvoiceDraftSaveController["save"]>[0]): Promise<SaveOutcome> => controller.save(request) })
  const removeLine = useMutation({ mutationFn: (arguments_: { readonly draft: DraftInvoice; readonly line: EditableInvoiceLine }) => controller.deleteLine(arguments_.draft, arguments_.line) })
  const removeDraft = useMutation({ mutationFn: (target: DraftInvoice) => controller.deleteDraft(target) })

  const outcomeError = (outcome: SaveOutcome | undefined): unknown =>
    outcome !== undefined && outcome.kind === "error" ? outcome.error : null
  const unconfirmedMessage = controller.unconfirmedMessage()
  const error = outcomeError(save.data) ?? outcomeError(removeLine.data) ?? outcomeError(removeDraft.data)
    ?? save.error ?? removeLine.error ?? removeDraft.error

  return {
    draft,
    pending: save.isPending || removeLine.isPending || removeDraft.isPending,
    savePending: save.isPending,
    error,
    unconfirmedMessage,
    // A document created here whose save failed later is kept on its new draft
    // URL: correcting the error and saving again resends only what is left.
    resumableSave: input.initialDraft === undefined && draft !== undefined && save.data?.kind === "error",
    notice,
    save: () => {
      save.mutate({
        draft,
        form: input.form,
        lines: input.lines,
        forcedUpdateLineIds: input.forcedUpdateLineIds,
        navigateOnCreate: input.initialDraft === undefined,
      })
    },
    deleteLine: (line) => {
      if (line.lineId === undefined) {
        setLines((current) => current.filter((item) => item.key !== line.key))
        return
      }
      if (draft !== undefined && window.confirm(`Ștergi linia „${line.description}” din draft?`)) {
        removeLine.mutate({ draft, line })
      }
    },
    // The deletion policy (derived and issued drafts are not deletable) lives
    // in the controller, so every caller gets the same refusal without a
    // request; this hook only asks the user to confirm.
    deleteDraft: () => {
      if (draft !== undefined && window.confirm("Ștergi definitiv acest draft?")) {
        removeDraft.mutate(draft)
      }
    },
  }
}
