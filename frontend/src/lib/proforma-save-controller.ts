import { createProformaIntent } from "./operation-recovery-intent.ts"
import type { RecoveryRequest } from "./operation-recovery-types.ts"
import type { AuthoringProformaInput } from "./proforma-models.ts"
import type { ProformaIdentity } from "./proforma-replay-client.ts"
import {
  UNCONFIRMED_PROFORMA, UNCONFIRMED_PROFORMA_EDITED,
  type ProformaSaveController, type ProformaSaveDependencies, type ProformaSaveOutcome, type ProformaSaveRequest,
} from "./proforma-save-types.ts"
import { createRecoverableWriter } from "./recoverable-write.ts"

/**
 * Authoring a proforma, as a plain object so the races can be tested without a
 * DOM.
 *
 * There is nothing to read first: a proforma is created whole in one call, so
 * unlike issuance from a saved draft there is no server-side copy to compare
 * the intent against. What remains is the same claim-before-send discipline —
 * the key is written down in the journal before the request leaves and kept
 * across a lost answer, because the proforma may already exist and only the
 * server's idempotency store can hand it back.
 *
 * An edited document after a lost answer is refused rather than sent: the old
 * key belongs to the document that left, and a new key would author a second
 * proforma with its own number.
 */
export const createProformaSaveController = (dependencies: ProformaSaveDependencies): ProformaSaveController => {
  const writer = createRecoverableWriter(dependencies)

  /**
   * A claimed record is only ever this controller's own intent — the journal
   * refuses a claim whose slot holds another operation — so a stored request of
   * any other kind is a programming fault, not a state to recover from.
   */
  const send = (
    csrfToken: string, request: RecoveryRequest, key: string, replay: boolean, payload: AuthoringProformaInput,
  ): Promise<ProformaIdentity> => {
    if (request.kind !== "create-proforma") throw new Error("Intenția salvată nu este o emitere de proformă.")
    return replay
      ? dependencies.client.replayProformaIssuance(csrfToken, request.body, key)
      : dependencies.client.createProforma(csrfToken, payload, key)
  }

  const save = async (request: ProformaSaveRequest): Promise<ProformaSaveOutcome> => {
    const outcome = await writer.run<ProformaIdentity>({
      intent: createProformaIntent(request.payload),
      blockedMessage: request.blockedMessage,
      changedMessage: UNCONFIRMED_PROFORMA_EDITED,
      send: (csrfToken, record, replay) => send(csrfToken, record.request, record.key, replay, request.payload),
      onSettled: (proforma) => { dependencies.effects.onSaved(proforma) },
      onOutcomeUnknown: dependencies.effects.onOutcomeUnknown,
    })
    if (outcome.kind !== "done") return outcome
    const { result: proforma, effectsError } = outcome
    return effectsError === undefined ? { kind: "saved", proforma } : { kind: "saved", proforma, effectsError }
  }

  return {
    save,
    unconfirmedSave: (): string | undefined => writer.unconfirmed() ? UNCONFIRMED_PROFORMA : undefined,
  }
}
