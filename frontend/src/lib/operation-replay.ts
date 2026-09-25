import { ApiFailure } from "./api-errors.ts"
import type { DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import { isLostResponse } from "./draft-reconciliation.ts"
import { isRecoveryConflict, type RecoveryPort } from "./operation-recovery-port.ts"
import type { KnownWrite } from "./operation-recovery-view.ts"
import type { RecoveryRecord } from "./operation-recovery-types.ts"

/**
 * Sending a stored intent again, exactly as it was stored.
 *
 * This is deliberately not part of the authoring controllers. They send the
 * document the form currently holds; a replay sends the request that was
 * written down before the first attempt, under the key that was written down
 * with it, which after a reload is the only thing that can still be recognised
 * by the server. Rebuilding the payload from a blank or edited form would be a
 * different document under an old key — the exact mistake the key exists to
 * prevent.
 *
 * Nothing is ever sent automatically: this runs when the user asks for it.
 */
export interface ReplayClient {
  readonly replayDraftCreation: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<DraftInvoice>
  readonly issueDraft: (csrfToken: string, id: string, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly replayInvoiceIssuance: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<IssuedInvoice>
}

export interface ReplayEffects {
  /** The draft as the server holds it now — never the stored snapshot written back over it. */
  readonly onDraft: (draft: DraftInvoice) => void
  readonly onIssued: (invoice: IssuedInvoice) => void
}

export type ReplayOutcome =
  /**
   * The write is confirmed. `effectsError` says something *after* it failed —
   * a navigation, a cache write — and it never downgrades the result to
   * unknown: the document exists, is named by this outcome, and must not be
   * written a second time.
   */
  | { readonly kind: "draft"; readonly draft: DraftInvoice; readonly effectsError?: unknown }
  | { readonly kind: "issued"; readonly invoice: IssuedInvoice; readonly effectsError?: unknown }
  | { readonly kind: "unknown"; readonly error: unknown }
  | { readonly kind: "conflict"; readonly error: unknown }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "aborted" }

export interface ReplayDependencies {
  readonly client: ReplayClient
  readonly recovery: RecoveryPort
  readonly csrfToken: () => string
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
  readonly alive: () => boolean
  readonly effects: ReplayEffects
}

export const REPLAY_SETTLED = "Operația a fost deja refuzată definitiv. Verifică registrul și închide avertismentul."

/** The document a finished replay is known to have produced, for the screen that could not follow it. */
export const replayKnownResult = (outcome: ReplayOutcome | undefined): KnownWrite | undefined => {
  if (outcome === undefined) return undefined
  if (outcome.kind === "draft") return { kind: "draft", id: outcome.draft.id, effectsError: outcome.effectsError }
  if (outcome.kind === "issued") return { kind: "invoice", id: outcome.invoice.id, effectsError: outcome.effectsError }
  return undefined
}

export const createOperationReplay = (dependencies: ReplayDependencies) => {
  let inFlight = false
  const owns = (started: number): boolean => dependencies.alive() && dependencies.ownsEpoch(started)

  const replay = async (record: RecoveryRecord): Promise<ReplayOutcome> => {
    if (inFlight) return { kind: "aborted" }
    if (record.state === "conflict") return { kind: "error", error: new Error(REPLAY_SETTLED) }
    inFlight = true
    try {
      const started = dependencies.epoch()
      const csrfToken = dependencies.csrfToken()
      if (!owns(started)) return { kind: "aborted" }
      const request = record.request
      try {
        if (request.kind === "create-draft") {
          const draft = await dependencies.client.replayDraftCreation(csrfToken, request.body, record.key)
          if (!owns(started)) return { kind: "aborted" }
          dependencies.recovery.resolve(record.key)
          try {
            dependencies.effects.onDraft(draft)
          } catch (effectsError) {
            return { kind: "draft", draft, effectsError }
          }
          return { kind: "draft", draft }
        }
        const invoice = request.kind === "issue-draft"
          ? await dependencies.client.issueDraft(csrfToken, request.draftId, record.key)
          : await dependencies.client.replayInvoiceIssuance(csrfToken, request.body, record.key)
        if (!owns(started)) return { kind: "aborted" }
        dependencies.recovery.resolve(record.key)
        try {
          dependencies.effects.onIssued(invoice)
        } catch (effectsError) {
          return { kind: "issued", invoice, effectsError }
        }
        return { kind: "issued", invoice }
      } catch (error) {
        if (!owns(started)) return { kind: "aborted" }
        // Still unknown: the intent and the key stay, so the next attempt is
        // still the same attempt.
        if (isLostResponse(error)) return { kind: "unknown", error }
        const code = error instanceof ApiFailure ? error.code : undefined
        if (code !== undefined && isRecoveryConflict(code)) {
          dependencies.recovery.markConflict(record.key, code)
          return { kind: "conflict", error }
        }
        dependencies.recovery.resolve(record.key)
        return { kind: "error", error }
      }
    } finally {
      inFlight = false
    }
  }

  return { replay }
}

export type OperationReplay = ReturnType<typeof createOperationReplay>
