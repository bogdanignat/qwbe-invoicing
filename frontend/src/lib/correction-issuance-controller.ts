import {
  ALREADY_CORRECTED, ALREADY_CORRECTED_CODE, UNCONFIRMED_CORRECTION, UNCONFIRMED_CORRECTION_CHANGED,
  type AlreadyCorrected, type CorrectionDependencies, type CorrectionIssuanceController, type CorrectionOutcome,
  type CorrectionRequest,
} from "./correction-issuance-types.ts"
import type { CorrectionDocument } from "./document-snapshot.ts"
import { createCorrectionIntent } from "./operation-recovery-intent.ts"
import type { RecoveryRecord } from "./operation-recovery-types.ts"
import { createRecoverableWriter } from "./recoverable-write.ts"

/**
 * Issuing a full storno, as a plain object so the races can be tested without a
 * DOM.
 *
 * A storno is a fiscal document with its own number, settled by idempotency
 * key exactly like a conversion: the key comes from the recovery journal,
 * written down before the request leaves and kept across a lost answer. The
 * server refuses a second storno itself with `invoice_already_corrected`, which
 * ends here as a state of the invoice, not as an error.
 *
 * A replay sends the stored body to the stored invoice under the stored key;
 * the form on screen is not consulted for it.
 */
export const createCorrectionIssuanceController = (
  dependencies: CorrectionDependencies,
): CorrectionIssuanceController => {
  const writer = createRecoverableWriter(dependencies)

  const send = (
    csrfToken: string, record: RecoveryRecord, replay: boolean, request: CorrectionRequest,
  ): Promise<CorrectionDocument> => {
    const stored = record.request
    if (stored.kind !== "create-correction") throw new Error("Intenția salvată nu este un document storno.")
    return replay
      ? dependencies.client.replayCorrection(csrfToken, stored.invoiceId, stored.body, record.key)
      : dependencies.client.createCorrection(csrfToken, request.invoiceId, request.body, record.key)
  }

  const alreadyCorrected = (code: string | undefined): AlreadyCorrected | undefined =>
    code === ALREADY_CORRECTED_CODE ? { kind: "already-corrected", message: ALREADY_CORRECTED } : undefined

  const issue = async (request: CorrectionRequest): Promise<CorrectionOutcome> => {
    const outcome = await writer.run<CorrectionDocument, AlreadyCorrected>({
      intent: createCorrectionIntent(request),
      blockedMessage: request.blockedMessage,
      changedMessage: UNCONFIRMED_CORRECTION_CHANGED,
      send: (csrfToken, record, replay) => send(csrfToken, record, replay, request),
      onSettled: (correction) => { dependencies.effects.onIssued(correction, request.invoiceId) },
      onOutcomeUnknown: () => { dependencies.effects.onOutcomeUnknown(request.invoiceId) },
      knownState: alreadyCorrected,
    })
    if (outcome.kind === "already-corrected") {
      dependencies.effects.onAlreadyCorrected(request.invoiceId)
      return outcome
    }
    if (outcome.kind !== "done") return outcome
    const { result, effectsError } = outcome
    return effectsError === undefined
      ? { kind: "issued", correction: result }
      : { kind: "issued", correction: result, effectsError }
  }

  return {
    issue,
    unconfirmedIssue: (): string | undefined => writer.unconfirmed() ? UNCONFIRMED_CORRECTION : undefined,
  }
}
