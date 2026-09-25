import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { useOperationRecovery } from "./use-operation-recovery.ts"
import { isTransientFailure } from "../lib/api-errors.ts"
import { createOperationLifetime } from "../lib/authoring-operation-lifetime.ts"
import { lifetimeMountEffect, lifetimeRequestsEffect } from "../lib/authoring-lifetime-wiring.ts"
import { createInvoiceDraftSaveController, type InvoiceDraftSaveController } from "../lib/invoice-draft-save-controller.ts"
import { draftRemovalFeedback } from "../lib/draft-removal-feedback.ts"
import type { SaveOutcome } from "../lib/draft-save-types.ts"
import { draftDeletionState } from "../lib/invoice-authoring-workflow.ts"
import type { DraftInvoice } from "../lib/draft-models.ts"

/**
 * Deletion requests are only valid for drafts the workflow allows: a derived
 * draft (created from an issued proforma) is owned by its proforma, so the UI
 * never offers it — and the shared save controller refuses it (and any issued
 * draft) before a request is sent, whatever a caller believes.
 */
export const draftIsDeletable = (draft: DraftInvoice): boolean =>
  draftDeletionState(draft).kind === "available"

export const draftsQueryKey = ["drafts"] as const
export const draftQueryKey = (id: string): readonly ["draft", string] => ["draft", id] as const

export interface DraftsListModel {
  readonly items: ReadonlyArray<DraftInvoice> | undefined
  readonly isPending: boolean
  readonly error: unknown
  readonly retry: (() => void) | undefined
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly removeDraft: (draft: DraftInvoice) => void
  readonly canDeleteDraft: (draft: DraftInvoice) => boolean
  readonly removalPending: boolean
  readonly removalError: unknown
}

/**
 * The draft registry for the invoices screen: one cursor page per fetch, with
 * its own loading, error and retry states, independent of the register above
 * it, so a failing drafts read never blanks the issued documents.
 *
 * Deletion goes through the same pure save controller the authoring screen
 * uses: the deletion policy, the single-flight guard, the session ownership
 * checks and the lost-answer reconciliation (a lost `DELETE` answered by a
 * `404` read is a success) live in one place, not twice. One instance for the
 * lifetime of the screen, so an in-flight delete is never reset by a re-render.
 */
export const useDrafts = (): DraftsListModel => {
  const { status, csrfToken, epoch, ownsEpoch } = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const query = useInfiniteQuery({
    queryKey: draftsQueryKey,
    enabled: status === "authenticated",
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      clients.drafts.listDrafts(pageParam === undefined ? undefined : { cursor: pageParam }, signal),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  // Two lifetimes, kept outside React: the mount decides whether an answer may
  // still reach this screen, the session decides how long the reconciliation
  // read may live. They are read when an operation runs, never during render.
  const recovery = useOperationRecovery()
  const [lifetime] = useState(createOperationLifetime)
  useEffect(() => lifetimeMountEffect(lifetime), [lifetime])
  useEffect(() => lifetimeRequestsEffect(lifetime), [lifetime, status])
  const [controller] = useState<InvoiceDraftSaveController>(() => createInvoiceDraftSaveController({
    client: {
      createDraft: (token, body, key) => clients.drafts.createDraft(token, body, key),
      replayDraftCreation: (token, body, key) => clients.drafts.replayDraftCreation(token, body, key),
      getDraft: (id) => clients.drafts.getDraft(id, lifetime.signal()),
      updateDraft: (token, id, body) => clients.drafts.updateDraft(token, id, body),
      addDraftLine: (token, id, body) => clients.drafts.addDraftLine(token, id, body),
      updateDraftLine: (token, id, lineId, body) => clients.drafts.updateDraftLine(token, id, lineId, body),
      deleteDraftLine: (token, id, lineId) => clients.drafts.deleteDraftLine(token, id, lineId),
      deleteDraft: (token, id) => clients.drafts.deleteDraft(token, id),
    },
    csrfToken,
    epoch,
    ownsEpoch,
    alive: () => lifetime.isAlive(),
    recovery: recovery.port,
    // The list never saves or edits, so those effects have no work here; the
    // deletion effects keep this screen's cache honest.
    effects: {
      recordDraft: () => undefined,
      recordLines: () => undefined,
      removeLine: () => undefined,
      invalidateDrafts: () => { void queryClient.invalidateQueries({ queryKey: draftsQueryKey }) },
      evictDraft: (id) => { queryClient.removeQueries({ queryKey: draftQueryKey(id), exact: true }) },
      notify: () => undefined,
      navigate: () => undefined,
    },
  }))
  const removal = useMutation({ mutationFn: (draft: DraftInvoice): Promise<SaveOutcome> => controller.deleteDraft(draft) })
  const feedback = draftRemovalFeedback(removal.data, removal.error, removal.isPending)
  return {
    items: query.data?.pages.flatMap((page) => page.items),
    isPending: query.isPending,
    error: query.error,
    retry: isTransientFailure(query.error)
      ? (query.isFetchNextPageError
        ? () => { void query.fetchNextPage() }
        : () => { void query.refetch() })
      : undefined,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => { void query.fetchNextPage() },
    // The policy itself lives in the controller; the hook only confirms.
    removeDraft: (draft) => {
      if (window.confirm(`Ștergi draftul pentru „${draft.customer.name}”?`)) removal.mutate(draft)
    },
    canDeleteDraft: draftIsDeletable,
    removalPending: feedback.pending,
    removalError: feedback.error,
  }
}
