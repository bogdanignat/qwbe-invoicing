import { ApiFailure } from "./api-errors.ts"
import type { AuthoringDocumentInput } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import { authoringPayloadMatchesDraft } from "./invoice-authoring-payload.ts"
import { isLostResponse } from "./draft-reconciliation.ts"
import {
  CONCURRENT_CHANGE, UNCONFIRMED_ISSUE, UNCONFIRMED_ISSUE_EDITED,
  type InvoiceIssuanceController, type IssuanceDependencies, type IssuanceOutcome, type IssuanceRequest,
} from "./invoice-issuance-types.ts"
import { requireCsrf } from "./require-csrf.ts"
import { operationFingerprint } from "./operation-idempotency.ts"
import { issueInvoiceIntent } from "./operation-recovery-intent.ts"
import type { RecoveryRequest } from "./operation-recovery-types.ts"
import { NOT_HYDRATED, RESOLVE_FAILED, isRecoveryConflict } from "./operation-recovery-port.ts"

const refused = (message: string): IssuanceOutcome => ({ kind: "error", error: new Error(message) })

/**
 * Issuance, as a plain object so the races can be tested without a DOM.
 *
 * Without a saved draft the document goes straight to `POST /invoices`. From a
 * saved draft the server's copy is read fresh and compared with the intent
 * first — issuing seals whatever the server holds, not whatever this screen
 * shows — and only then is `POST /drafts/{id}/issue` sent. That read happens
 * before the intent is claimed, so a read that fails or cannot be decoded is
 * an ordinary error: nothing was written, and nothing is left unresolved.
 *
 * Both endpoints replay by idempotency key, and the key comes from the recovery
 * journal, written down before the request leaves and kept across a lost answer
 * — the invoice may already exist, and only the server's store can hand it
 * back. The fresh-draft check deliberately does not block a legitimate replay:
 * a draft that already reads `issued` is exactly what a previous, answer-less
 * attempt looks like from the server's side.
 */
export const createInvoiceIssuanceController = (dependencies: IssuanceDependencies): InvoiceIssuanceController => {
  let inFlight = false
  let unconfirmedFingerprint: string | undefined
  const owns = (started: number): boolean =>
    dependencies.alive() && dependencies.ownsEpoch(started)

  const guardDraft = async (started: number, request: IssuanceRequest): Promise<IssuanceOutcome | undefined> => {
    if (request.draftId === undefined) return undefined
    const fresh = await dependencies.client.getDraft(request.draftId)
    if (!owns(started)) return { kind: "aborted" }
    return fresh.status === "draft" && !authoringPayloadMatchesDraft(request.payload, fresh)
      ? refused(CONCURRENT_CHANGE)
      : undefined
  }

  const send = (csrfToken: string, request: RecoveryRequest, key: string, replay: boolean, payload: AuthoringDocumentInput) => {
    if (request.kind === "issue-draft") return dependencies.client.issueDraft(csrfToken, request.draftId, key)
    if (request.kind === "create-draft") throw new Error("Intenția salvată nu este o emitere.")
    return replay
      ? dependencies.client.replayInvoiceIssuance(csrfToken, request.body, key)
      : dependencies.client.issueInvoice(csrfToken, payload, key)
  }

  const issue = async (request: IssuanceRequest): Promise<IssuanceOutcome> => {
    if (inFlight) return { kind: "busy" }
    if (request.blockedMessage !== undefined) return refused(request.blockedMessage)
    if (!dependencies.recovery.hydrated()) return refused(NOT_HYDRATED)
    const fingerprint = operationFingerprint(request.payload)
    if (unconfirmedFingerprint !== undefined && unconfirmedFingerprint !== fingerprint) {
      return refused(UNCONFIRMED_ISSUE_EDITED)
    }
    inFlight = true
    try {
      const started = dependencies.epoch()
      const csrfToken = requireCsrf(dependencies.csrfToken())
      if (!owns(started)) return { kind: "aborted" }
      let guarded: IssuanceOutcome | undefined
      try {
        guarded = await guardDraft(started, request)
      } catch (error) {
        // A read, not a write: whatever it says, no invoice was emitted.
        return owns(started) ? { kind: "error", error } : { kind: "aborted" }
      }
      if (guarded !== undefined) return guarded
      const claimed = dependencies.recovery.claim(issueInvoiceIntent(request.payload, request.draftId))
      if (claimed.kind === "blocked") return refused(claimed.message)
      const { record } = claimed
      let invoice: IssuedInvoice
      try {
        invoice = await send(csrfToken, record.request, record.key, claimed.replay, request.payload)
      } catch (error) {
        if (!owns(started)) return { kind: "aborted" }
        if (isLostResponse(error)) {
          // The answer may exist in the server's idempotency store only: the
          // intent and its key stay, so a retry replays this exact document,
          // while an edited one is refused rather than issued twice.
          unconfirmedFingerprint = fingerprint
          dependencies.effects.onOutcomeUnknown(request.draftId)
          return { kind: "error", error }
        }
        unconfirmedFingerprint = undefined
        const code = error instanceof ApiFailure ? error.code : undefined
        if (code !== undefined && isRecoveryConflict(code)) {
          dependencies.recovery.markConflict(record.key, code)
        } else {
          dependencies.recovery.resolve(record.key)
        }
        return { kind: "error", error }
      }
      if (!owns(started)) return { kind: "aborted" }
      unconfirmedFingerprint = undefined
      const cleared = dependencies.recovery.resolve(record.key)
      try {
        dependencies.effects.onIssued(invoice, request.draftId)
      } catch (effectsError) {
        return { kind: "issued", invoice, effectsError }
      }
      return cleared ? { kind: "issued", invoice } : { kind: "issued", invoice, effectsError: new Error(RESOLVE_FAILED) }
    } finally {
      inFlight = false
    }
  }

  return {
    issue,
    unconfirmedIssue: (): string | undefined =>
      unconfirmedFingerprint === undefined ? undefined : UNCONFIRMED_ISSUE,
  }
}
