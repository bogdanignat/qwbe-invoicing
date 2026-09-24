import type { DraftInvoice, DraftLineInput, UpdateDraftInput } from "./draft-models.ts"
import type { InvoiceAuthoringForm, LineSaveOperation } from "./invoice-authoring-model.ts"
import { draftLinePayload, updateDraftPayload } from "./invoice-authoring-payload.ts"
import { isLostResponse, reconcileHeaderUpdate, reconcileLineCreate, reconcileLineUpdate } from "./draft-reconciliation.ts"
import { UNCONFIRMED_HEADER, UNCONFIRMED_LINE } from "./draft-save-types.ts"
import type { DraftSaveClient, Fresh, SaveOutcome, WriteResult } from "./draft-save-types.ts"

export interface DraftWriteContext {
  readonly client: Pick<DraftSaveClient, "updateDraft" | "addDraftLine" | "updateDraftLine">
  readonly owns: (started: number) => boolean
  readonly freshDraft: (started: number, id: string) => Promise<Fresh>
  readonly blocked: (message: string) => SaveOutcome
}

/**
 * One header write and one line write, each with its own lost-answer protocol:
 * a fresh read is taken before anything is re-sent, a verdict the read cannot
 * support blocks the save, and a write is never re-sent blindly.
 */
export const createDraftWriteSteps = (context: DraftWriteContext) => {
  const writeHeader = async (
    started: number, csrfToken: string, form: InvoiceAuthoringForm, draft: DraftInvoice,
  ): Promise<WriteResult> => {
    if (!context.owns(started)) return { outcome: { kind: "aborted" } }
    const payload: UpdateDraftInput = updateDraftPayload(form)
    const send = (): Promise<DraftInvoice> => context.client.updateDraft(csrfToken, draft.id, payload)
    let updated: DraftInvoice
    try {
      updated = await send()
    } catch (error) {
      if (!context.owns(started)) return { outcome: { kind: "aborted" } }
      if (!isLostResponse(error)) return { outcome: { kind: "error", error } }
      const fresh = await context.freshDraft(started, draft.id)
      if (fresh.kind === "aborted") return { outcome: { kind: "aborted" } }
      if (fresh.kind === "failed") return { outcome: context.blocked(UNCONFIRMED_HEADER) }
      const verdict = reconcileHeaderUpdate(form, fresh.draft)
      if (verdict.kind === "missing") {
        // A header update sets state, so re-sending it cannot double anything.
        try {
          updated = await send()
        } catch (retryError) {
          return { outcome: context.owns(started) ? { kind: "error", error: retryError } : { kind: "aborted" } }
        }
      } else {
        updated = verdict.draft
      }
    }
    if (!context.owns(started)) return { outcome: { kind: "aborted" } }
    return { draft: updated }
  }

  const writeLine = async (
    started: number,
    csrfToken: string,
    current: DraftInvoice,
    operation: LineSaveOperation,
    previousLineIds: ReadonlySet<string>,
  ): Promise<WriteResult> => {
    if (!context.owns(started)) return { outcome: { kind: "aborted" } }
    const payload: DraftLineInput = draftLinePayload(operation.line)
    const send = (): Promise<DraftInvoice> => operation.kind === "create"
      ? context.client.addDraftLine(csrfToken, current.id, payload)
      : context.client.updateDraftLine(csrfToken, current.id, operation.lineId, payload)
    let updated: DraftInvoice
    try {
      updated = await send()
    } catch (error) {
      if (!context.owns(started)) return { outcome: { kind: "aborted" } }
      if (!isLostResponse(error)) return { outcome: { kind: "error", error } }
      const fresh = await context.freshDraft(started, current.id)
      if (fresh.kind === "aborted") return { outcome: { kind: "aborted" } }
      if (fresh.kind === "failed") return { outcome: context.blocked(UNCONFIRMED_LINE) }
      const verdict = operation.kind === "create"
        ? reconcileLineCreate(payload, previousLineIds, fresh.draft)
        : reconcileLineUpdate(operation.lineId, payload, fresh.draft)
      if (verdict.kind === "diverged") return { outcome: context.blocked(verdict.message) }
      if (verdict.kind === "missing") {
        // Absent from the fresh read, so re-sending cannot duplicate — unless
        // this answer is lost too, which is exactly what a blocked save is for.
        try {
          updated = await send()
        } catch (retryError) {
          if (!context.owns(started)) return { outcome: { kind: "aborted" } }
          return { outcome: isLostResponse(retryError) ? context.blocked(UNCONFIRMED_LINE) : { kind: "error", error: retryError } }
        }
      } else {
        updated = verdict.draft
      }
    }
    if (!context.owns(started)) return { outcome: { kind: "aborted" } }
    return { draft: updated }
  }

  return { writeHeader, writeLine }
}
