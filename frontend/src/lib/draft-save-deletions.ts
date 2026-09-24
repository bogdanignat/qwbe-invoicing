import type { DraftInvoice } from "./draft-models.ts"
import type { EditableInvoiceLine } from "./invoice-authoring-model.ts"
import { isLostResponse } from "./draft-reconciliation.ts"
import { ApiFailure } from "./api-errors.ts"
import { requireCsrf } from "./require-csrf.ts"
import { DERIVED_DRAFT_DELETE_REFUSED, ISSUED_DRAFT_DELETE_REFUSED, UNCONFIRMED_LINE, type DraftSaveClient, type DraftSaveEffects, type Fresh, type SaveOutcome } from "./draft-save-types.ts"

export interface DraftDeletionDependencies {
  readonly client: Pick<DraftSaveClient, "deleteDraftLine" | "deleteDraft" | "getDraft">
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly owns: (started: number) => boolean
  readonly freshDraft: (started: number, id: string) => Promise<Fresh>
  readonly effects: DraftSaveEffects
}

/**
 * Line and whole-draft deletion, each reconciled against a fresh read when its
 * answer is lost: a line that is gone counts as deleted, one that is still
 * there is deleted again, and a read that says nothing stops with the honest
 * error instead of guessing.
 */
export const createDraftDeletions = (dependencies: DraftDeletionDependencies) => {
  /** Deletes a line the server already knows; a lost answer is reconciled against a fresh read. */
  const deleteLine = async (draft: DraftInvoice, line: EditableInvoiceLine): Promise<SaveOutcome> => {
    const lineId = line.lineId
    if (lineId === undefined) return { kind: "error", error: new Error("Linia nu este salvată.") }
    const started = dependencies.epoch()
    if (!dependencies.owns(started)) return { kind: "aborted" }
    const csrfToken = requireCsrf(dependencies.csrfToken())
    const send = (): Promise<DraftInvoice> => dependencies.client.deleteDraftLine(csrfToken, draft.id, lineId)
    let updated: DraftInvoice
    try {
      updated = await send()
    } catch (error) {
      if (!dependencies.owns(started)) return { kind: "aborted" }
      if (!isLostResponse(error)) return { kind: "error", error }
      const fresh = await dependencies.freshDraft(started, draft.id)
      if (fresh.kind === "aborted") return { kind: "aborted" }
      if (fresh.kind === "failed") return { kind: "error", error: new Error(UNCONFIRMED_LINE) }
      if (fresh.draft.lines.some((item) => item.id === lineId)) {
        try {
          updated = await send()
        } catch (retryError) {
          if (!dependencies.owns(started)) return { kind: "aborted" }
          return { kind: "error", error: retryError }
        }
      } else {
        updated = fresh.draft
      }
    }
    if (!dependencies.owns(started)) return { kind: "aborted" }
    dependencies.effects.recordDraft(updated)
    dependencies.effects.removeLine(line.key)
    dependencies.effects.invalidateDrafts()
    dependencies.effects.notify("Linia a fost ștearsă.")
    return { kind: "saved" }
  }

  /** Deletes the whole draft; a lost answer is reconciled against a fresh read. */
  const deleteDraft = async (draft: DraftInvoice): Promise<SaveOutcome> => {
    // The deletion policy lives here, not in the hooks that call it: a derived
    // draft belongs to its proforma and an issued draft is a fiscal document,
    // so neither is ever asked of the server.
    if (draft.sourceProformaId !== null) return { kind: "error", error: new Error(DERIVED_DRAFT_DELETE_REFUSED) }
    if (draft.status !== "draft") return { kind: "error", error: new Error(ISSUED_DRAFT_DELETE_REFUSED) }
    const started = dependencies.epoch()
    if (!dependencies.owns(started)) return { kind: "aborted" }
    const csrfToken = requireCsrf(dependencies.csrfToken())
    const send = (): Promise<void> => dependencies.client.deleteDraft(csrfToken, draft.id)
    try {
      await send()
    } catch (error) {
      if (!dependencies.owns(started)) return { kind: "aborted" }
      if (!isLostResponse(error)) return { kind: "error", error }
      // A `404` on the fresh read is the delete confirmed: the draft is gone.
      let gone = false
      let present: DraftInvoice | undefined
      try {
        present = await dependencies.client.getDraft(draft.id)
      } catch (readError) {
        if (readError instanceof ApiFailure && readError.status === 404) gone = true
      }
      if (!dependencies.owns(started)) return { kind: "aborted" }
      if (!gone) {
        if (present === undefined) {
          return { kind: "error", error: new Error("Rezultatul ștergerii nu poate fi confirmat. Reîncarcă lista de drafturi înainte de a continua.") }
        }
        try {
          await send()
        } catch (retryError) {
          if (!dependencies.owns(started)) return { kind: "aborted" }
          return { kind: "error", error: retryError }
        }
      }
    }
    if (!dependencies.owns(started)) return { kind: "aborted" }
    dependencies.effects.navigate("/invoices")
    dependencies.effects.evictDraft(draft.id)
    dependencies.effects.invalidateDrafts()
    dependencies.effects.notify("Draftul a fost șters.")
    return { kind: "saved" }
  }

  return { deleteLine, deleteDraft }
}
