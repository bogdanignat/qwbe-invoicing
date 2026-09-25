import { convertProformaIntent } from "./operation-recovery-intent.ts"
import type { RecoveryRecord } from "./operation-recovery-types.ts"
import { conversionRefusal } from "./proforma-conversion.ts"
import {
  ALREADY_CONVERTED, ALREADY_CONVERTED_CODE, UNCONFIRMED_CONVERSION, UNCONFIRMED_CONVERSION_CHANGED,
  type AlreadyConverted, type ConversionDependencies, type ConversionOutcome, type ConversionRequest,
  type ConversionResult, type ProformaConversionController,
} from "./proforma-conversion-types.ts"
import { createRecoverableWriter } from "./recoverable-write.ts"

/**
 * Converting a proforma, as a plain object so the races can be tested without a
 * DOM.
 *
 * Both conversions are writes the server settles by idempotency key, and the key
 * comes from the recovery journal — written down before the request leaves and
 * kept across a lost answer, because only the server's store can say whether the
 * invoice or the draft already exists. Nothing is read first: unlike issuing a
 * saved draft there is no local copy to compare, and the server refuses a second
 * conversion itself with `proforma_already_converted`.
 *
 * A replay sends the stored body under the stored key. The selection on screen is
 * not consulted for it: a series chosen after the first attempt would be a
 * different request, and the journal refuses that rather than sending it under a
 * key that is already spent.
 *
 * The fiscal rule is applied to the request and not to the buttons: whoever
 * calls `convert` — this screen, a later one, a replay — gets the same refusal
 * for a positive proforma without a due date.
 */
export const createProformaConversionController = (
  dependencies: ConversionDependencies,
): ProformaConversionController => {
  const writer = createRecoverableWriter(dependencies)

  const send = async (
    csrfToken: string, record: RecoveryRecord, replay: boolean, request: ConversionRequest,
  ): Promise<ConversionResult> => {
    const stored = record.request
    if (stored.kind === "convert-proforma-invoice") {
      return {
        kind: "invoice",
        invoice: replay
          ? await dependencies.client.replayInvoiceFromProforma(csrfToken, stored.proformaId, stored.body, record.key)
          : await dependencies.client.convertToInvoice(csrfToken, request.proformaId, request.invoiceSeries, record.key),
      }
    }
    if (stored.kind === "convert-proforma-draft") {
      return {
        kind: "draft",
        draft: replay
          ? await dependencies.client.replayDraftFromProforma(csrfToken, stored.proformaId, stored.body, record.key)
          : await dependencies.client.convertToDraft(csrfToken, request.proformaId, request.invoiceSeries, record.key),
      }
    }
    throw new Error("Intenția salvată nu este o conversie de proformă.")
  }

  const alreadyConverted = (code: string | undefined): AlreadyConverted | undefined =>
    code === ALREADY_CONVERTED_CODE ? { kind: "already-converted", message: ALREADY_CONVERTED } : undefined

  const convert = async (request: ConversionRequest): Promise<ConversionOutcome> => {
    const outcome = await writer.run<ConversionResult, AlreadyConverted>({
      intent: convertProformaIntent(request),
      // The screen's own block first, then the rule this controller owns: a
      // caller that offers no message at all still cannot emit an invoice for a
      // positive proforma that has no due date.
      blockedMessage: request.blockedMessage ?? conversionRefusal(request),
      changedMessage: UNCONFIRMED_CONVERSION_CHANGED,
      send: (csrfToken, record, replay) => send(csrfToken, record, replay, request),
      onSettled: (result) => { dependencies.effects.onConverted(result, request.proformaId) },
      onOutcomeUnknown: () => { dependencies.effects.onOutcomeUnknown(request.proformaId) },
      knownState: alreadyConverted,
    })
    if (outcome.kind === "already-converted") {
      // Nothing is in doubt: the conversion happened, and the document it
      // produced is what the proforma now carries. Re-reading it is what turns
      // the section into a link instead of two buttons for the same refusal.
      dependencies.effects.onAlreadyConverted(request.proformaId)
      return outcome
    }
    if (outcome.kind !== "done") return outcome
    const { result, effectsError } = outcome
    return effectsError === undefined ? { kind: "converted", result } : { kind: "converted", result, effectsError }
  }

  return {
    convert,
    unconfirmedConversion: (): string | undefined =>
      writer.unconfirmed() ? UNCONFIRMED_CONVERSION : undefined,
  }
}
