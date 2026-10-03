import type { AuthoringDocumentInput, CreateDraftInput } from "./draft-models.ts"
import { operationFingerprint } from "./operation-idempotency.ts"
import type { RecoveryIntent } from "./operation-recovery-journal.ts"
import type { RecoverySummary } from "./operation-recovery-types.ts"
import type { ProformaConversionTarget } from "./proforma-conversion.ts"
import type { AuthoringProformaInput } from "./proforma-models.ts"

/**
 * The intent behind one recoverable write, built from the payload that is
 * actually about to be sent.
 *
 * The fingerprint is the canonical form of that payload, so "the same document
 * again" keeps one key across a reload while an edited document cannot slip
 * under the old one. The summary is the recognisable part — who, which series,
 * which date, how many lines — and it is stored rather than re-derived, because
 * the whole point of the card is to describe the request that left, not the
 * form as it stands now.
 */
const SAVED_CUSTOMER = "Client salvat"

export const recoverySummary = (input: CreateDraftInput): RecoverySummary => ({
  buyerName: input.customer === undefined ? SAVED_CUSTOMER : input.customer.name,
  series: input.series,
  issueDate: input.issueDate,
  lineCount: input.lines?.length ?? 0,
})

/** Creating a draft: the whole document travels in the body, so the body is the request. */
export const createDraftIntent = (body: CreateDraftInput): RecoveryIntent => ({
  operation: "create-draft",
  request: { kind: "create-draft", body },
  fingerprint: operationFingerprint(body),
  summary: recoverySummary(body),
})

/**
 * Issuing. From a saved draft the request is the draft's id and nothing else —
 * the server seals what it already holds — but the fingerprint is still taken
 * from the document on screen, so an edited form cannot replay the key that was
 * sent for the previous one.
 */
export const issueInvoiceIntent = (
  payload: AuthoringDocumentInput,
  draftId: string | undefined,
): RecoveryIntent => ({
  operation: "issue-invoice",
  request: draftId === undefined
    ? { kind: "issue-invoice", body: payload }
    : { kind: "issue-draft", draftId },
  fingerprint: operationFingerprint(payload),
  summary: recoverySummary(payload),
})

/**
 * Authoring a proforma. The document travels whole in the body, like a created
 * draft, so the body is the request and the fingerprint is that body — the
 * series is read out of `proformaSeries` for the card, because that is what the
 * proforma schema calls it.
 */
export const createProformaIntent = (body: AuthoringProformaInput): RecoveryIntent => ({
  operation: "create-proforma",
  request: { kind: "create-proforma", body },
  fingerprint: operationFingerprint(body),
  summary: {
    buyerName: body.customer === undefined ? SAVED_CUSTOMER : body.customer.name,
    series: body.proformaSeries,
    issueDate: body.issueDate,
    lineCount: body.lines.length,
  },
})

export interface ConvertProformaIntentInput {
  readonly target: ProformaConversionTarget
  readonly proformaId: string
  readonly invoiceSeries: string
  /** Built from the proforma by the screen: the journal never reads a document itself. */
  readonly summary: RecoverySummary
}

/**
 * Converting a proforma. The two targets are two operations, not one with a
 * flag: the card has to say which document was asked for, and a lost answer to
 * "make me an invoice" must never be settled by replaying "make me a draft".
 *
 * The proforma's id enters the fingerprint although it travels in the path
 * rather than in the body — two different proformas converted into the same
 * series would otherwise look like one request replayed, and the second would be
 * sent under the first one's key.
 */
export const convertProformaIntent = (input: ConvertProformaIntentInput): RecoveryIntent => {
  const operation = input.target === "invoice" ? "convert-proforma-invoice" : "convert-proforma-draft"
  const body = { invoiceSeries: input.invoiceSeries }
  return {
    operation,
    request: { kind: operation, proformaId: input.proformaId, body },
    fingerprint: operationFingerprint({ ...body, proformaId: input.proformaId, target: input.target }),
    summary: input.summary,
  }
}
