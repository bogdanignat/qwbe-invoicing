import { ApiFailure } from "./api-errors.ts"
import type { DraftInvoice } from "./draft-models.ts"
import { isLostResponse } from "./draft-reconciliation.ts"
import {
  UNCONFIRMED_CREATE,
  type DraftSaveClient, type DraftSaveEffects, type SaveOutcome, type SaveRequest,
} from "./draft-save-types.ts"
import { draftLinesForEditing } from "./document-authoring-options.ts"
import { createDraftPayload, draftLinePayload } from "./invoice-authoring-payload.ts"
import { createDraftIntent } from "./operation-recovery-intent.ts"
import {
  NOT_HYDRATED, RESOLVE_FAILED, isRecoveryConflict, type RecoveryPort,
} from "./operation-recovery-port.ts"

/**
 * Creating a draft: one request, one key, one answer.
 *
 * The whole document — header and every line — travels in a single `POST
 * /api/drafts` under an idempotency key written down before the request leaves.
 * The server creates the header, all the lines, the idempotency record and the
 * audit entry in one transaction, so there is no half-draft to inherit and
 * nothing left to add afterwards: this step returns `saved` itself and the
 * pending-line loop never runs for a document that has just been created.
 *
 * A replay sends the request that was stored, not a payload rebuilt from the
 * form as it stands now, and under the key that was stored. That is the whole
 * value of the journal: the second attempt has to be indistinguishable from the
 * first, or the server cannot recognise it.
 */
export interface DraftCreateDependencies {
  readonly client: DraftSaveClient
  readonly effects: DraftSaveEffects
  readonly recovery: RecoveryPort
  readonly owns: (started: number) => boolean
  readonly blocked: (message: string) => SaveOutcome
}

const refused = (message: string): SaveOutcome => ({ kind: "error", error: new Error(message) })

const conflictCode = (error: unknown): string | undefined => {
  if (!(error instanceof ApiFailure)) return undefined
  return isRecoveryConflict(error.code) ? error.code : undefined
}

export const createDraftStep = async (
  dependencies: DraftCreateDependencies,
  started: number,
  csrfToken: string,
  request: SaveRequest,
): Promise<SaveOutcome> => {
  if (!dependencies.recovery.hydrated()) return refused(NOT_HYDRATED)
  const payload = {
    ...createDraftPayload(request.form),
    lines: request.lines.map(draftLinePayload),
  }
  const claimed = dependencies.recovery.claim(createDraftIntent(payload))
  if (claimed.kind === "blocked") return refused(claimed.message)
  const { record } = claimed
  if (!dependencies.owns(started)) return { kind: "aborted" }
  let created: DraftInvoice
  try {
    created = claimed.replay && record.request.kind === "create-draft"
      ? await dependencies.client.replayDraftCreation(csrfToken, record.request.body, record.key)
      : await dependencies.client.createDraft(csrfToken, payload, record.key)
  } catch (error) {
    if (!dependencies.owns(started)) return { kind: "aborted" }
    // The answer is unknown: the intent and its key stay on disk, because only
    // a replay under that key can ever tell what the server did.
    if (isLostResponse(error)) return dependencies.blocked(UNCONFIRMED_CREATE)
    const conflict = conflictCode(error)
    if (conflict !== undefined) {
      // A spent key. Rotating it would author a second draft, retrying it would
      // repeat the refusal: the evidence is kept and the user decides.
      dependencies.recovery.markConflict(record.key, conflict)
      return { kind: "error", error }
    }
    // A settled refusal: nothing was written, so the slot is free again.
    dependencies.recovery.resolve(record.key)
    return { kind: "error", error }
  }
  if (!dependencies.owns(started)) return { kind: "aborted" }
  const cleared = dependencies.recovery.resolve(record.key)
  dependencies.effects.recordDraft(created)
  // The server's lines carry the ids the form needs; adopting them here is what
  // makes a follow-up save an update instead of a second create.
  dependencies.effects.recordLines(draftLinesForEditing(created))
  dependencies.effects.invalidateDrafts()
  if (request.navigateOnCreate) {
    dependencies.effects.navigate(`/drafts/${encodeURIComponent(created.id)}`)
  }
  dependencies.effects.notify(cleared ? "Draftul a fost salvat." : RESOLVE_FAILED)
  return { kind: "saved" }
}
