import { createDraftStep } from "./draft-save-create.ts"
import { createDraftDeletions } from "./draft-save-deletions.ts"
import { createDraftWriteSteps } from "./draft-save-writes.ts"
import type {
  DraftSaveDependencies, Fresh, SaveOutcome, SaveRequest,
} from "./draft-save-types.ts"
import type { DraftInvoice } from "./draft-models.ts"
import type { EditableInvoiceLine } from "./invoice-authoring-model.ts"
import { headerMatchesDraft, pendingLineOperations } from "./invoice-authoring-readiness.ts"
import { draftLinesForEditing } from "./document-authoring-options.ts"
import { requireCsrf } from "./require-csrf.ts"

/**
 * The save orchestration, as a plain object so the races can be tested without
 * a DOM. A document that does not exist yet is created whole, in one
 * idempotent request, and the save ends there. A document that already exists
 * takes the incremental path: header, then one line at a time, each answer
 * recorded before the next request leaves, every chained write preceded and
 * every answer followed by an ownership check.
 *
 * Only the create carries server idempotency; the update writes do not, so a
 * lost answer on those cannot be retried blindly. A lost answer on a *known* draft is reconciled against a
 * fresh read before anything is re-sent, and when reconciliation cannot tell
 * what happened the save is blocked rather than risk a duplicate line.
 */
export const createInvoiceDraftSaveController = (dependencies: DraftSaveDependencies) => {
  const owns = (started: number): boolean =>
    dependencies.alive() && dependencies.ownsEpoch(started)
  let unconfirmedMessage: string | undefined
  let saveInFlight = false
  let lineDeleteInFlight = false
  let draftDeleteInFlight = false

  const blocked = (message: string): SaveOutcome => {
    unconfirmedMessage = message
    dependencies.effects.invalidateDrafts()
    return { kind: "unconfirmed", message }
  }

  const freshDraft = async (started: number, id: string): Promise<Fresh> => {
    try {
      const fresh = await dependencies.client.getDraft(id)
      return owns(started) ? { kind: "draft", draft: fresh } : { kind: "aborted" }
    } catch {
      return owns(started) ? { kind: "failed" } : { kind: "aborted" }
    }
  }

  const writes = createDraftWriteSteps({ client: dependencies.client, owns, freshDraft, blocked })
  const creation = {
    client: dependencies.client,
    effects: dependencies.effects,
    recovery: dependencies.recovery,
    owns,
    blocked,
  }

  const save = async (request: SaveRequest): Promise<SaveOutcome> => {
    if (saveInFlight) return { kind: "busy" }
    const message = unconfirmedMessage
    if (message !== undefined) return { kind: "unconfirmed", message }
    saveInFlight = true
    try {
      const started = dependencies.epoch()
      const csrfToken = requireCsrf(dependencies.csrfToken())
      let workingDraft = request.draft
      let workingLines = request.lines
      // The create is terminal: the server already holds every line, so the
      // pending-line loop below is exactly what must not run afterwards.
      if (workingDraft === undefined) {
        return await createDraftStep(creation, started, csrfToken, request)
      }
      if (!headerMatchesDraft(request.form, workingDraft)) {
        const header = await writes.writeHeader(started, csrfToken, request.form, workingDraft)
        if ("outcome" in header) return header.outcome
        workingDraft = header.draft
        dependencies.effects.recordDraft(workingDraft)
      }
      let current = workingDraft
      for (const operation of pendingLineOperations(workingLines, current, request.forcedUpdateLineIds(current))) {
        const previousLineIds = new Set(current.lines.map((line) => line.id))
        const written = await writes.writeLine(started, csrfToken, current, operation, previousLineIds)
        if ("outcome" in written) return written.outcome
        const updated = written.draft
        const persisted = operation.kind === "create"
          ? updated.lines.find((line) => !previousLineIds.has(line.id))
          : updated.lines.find((line) => line.id === operation.lineId)
        if (persisted === undefined) return { kind: "error", error: new Error("Serverul nu a returnat linia salvată.") }
        const editable = draftLinesForEditing({ ...updated, lines: [persisted] })[0]
        if (editable === undefined) return { kind: "error", error: new Error("Linia salvată nu a putut fi actualizată local.") }
        current = updated
        workingLines = workingLines.map((line) => line.key === operation.line.key ? editable : line)
        dependencies.effects.recordDraft(current)
        dependencies.effects.recordLines(workingLines)
      }
      dependencies.effects.invalidateDrafts()
      if (request.navigateOnCreate) {
        dependencies.effects.navigate(`/drafts/${encodeURIComponent(current.id)}`)
      }
      dependencies.effects.notify("Toate modificările draftului au fost salvate.")
      return { kind: "saved" }
    } finally {
      saveInFlight = false
    }
  }

  const deletions = createDraftDeletions({
    client: dependencies.client,
    csrfToken: dependencies.csrfToken,
    epoch: dependencies.epoch,
    owns,
    freshDraft,
    effects: dependencies.effects,
  })
  const deleteLine = async (draft: DraftInvoice, line: EditableInvoiceLine): Promise<SaveOutcome> => {
    if (saveInFlight || lineDeleteInFlight) return { kind: "busy" }
    const message = unconfirmedMessage
    if (message !== undefined) return { kind: "unconfirmed", message }
    lineDeleteInFlight = true
    try {
      return await deletions.deleteLine(draft, line)
    } finally {
      lineDeleteInFlight = false
    }
  }
  const deleteDraft = async (draft: DraftInvoice): Promise<SaveOutcome> => {
    if (saveInFlight || draftDeleteInFlight) return { kind: "busy" }
    const message = unconfirmedMessage
    if (message !== undefined) return { kind: "unconfirmed", message }
    draftDeleteInFlight = true
    try {
      return await deletions.deleteDraft(draft)
    } finally {
      draftDeleteInFlight = false
    }
  }

  return { save, deleteLine, deleteDraft, unconfirmedMessage: () => unconfirmedMessage }
}

export type InvoiceDraftSaveController = ReturnType<typeof createInvoiceDraftSaveController>
