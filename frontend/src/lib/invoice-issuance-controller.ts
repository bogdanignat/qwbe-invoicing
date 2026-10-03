import type { AuthoringDocumentInput } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import { authoringPayloadMatchesDraft } from "./invoice-authoring-payload.ts"
import {
  CONCURRENT_CHANGE, UNCONFIRMED_ISSUE, UNCONFIRMED_ISSUE_EDITED,
  type InvoiceIssuanceController, type IssuanceDependencies, type IssuanceOutcome, type IssuanceRequest,
} from "./invoice-issuance-types.ts"
import { issueInvoiceIntent } from "./operation-recovery-intent.ts"
import type { RecoveryRequest } from "./operation-recovery-types.ts"
import { createRecoverableWriter } from "./recoverable-write.ts"

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
  const writer = createRecoverableWriter(dependencies)

  const guardDraft = async (request: IssuanceRequest): Promise<string | undefined> => {
    if (request.draftId === undefined) return undefined
    const fresh = await dependencies.client.getDraft(request.draftId)
    return fresh.status === "draft" && !authoringPayloadMatchesDraft(request.payload, fresh)
      ? CONCURRENT_CHANGE
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
    const outcome = await writer.run<IssuedInvoice>({
      intent: issueInvoiceIntent(request.payload, request.draftId),
      blockedMessage: request.blockedMessage,
      changedMessage: UNCONFIRMED_ISSUE_EDITED,
      preflight: () => guardDraft(request),
      send: (csrfToken, record, replay) => send(csrfToken, record.request, record.key, replay, request.payload),
      onSettled: (invoice) => { dependencies.effects.onIssued(invoice, request.draftId) },
      onOutcomeUnknown: () => { dependencies.effects.onOutcomeUnknown(request.draftId) },
    })
    if (outcome.kind !== "done") return outcome
    const { result: invoice, effectsError } = outcome
    return effectsError === undefined ? { kind: "issued", invoice } : { kind: "issued", invoice, effectsError }
  }

  return {
    issue,
    unconfirmedIssue: (): string | undefined => writer.unconfirmed() ? UNCONFIRMED_ISSUE : undefined,
  }
}
