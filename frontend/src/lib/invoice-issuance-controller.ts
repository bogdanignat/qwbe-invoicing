import type { AuthoringDocumentInput, DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import { authoringPayloadMatchesDraft } from "./invoice-authoring-payload.ts"
import { isLostResponse } from "./draft-reconciliation.ts"
import { requireCsrf } from "./require-csrf.ts"
import type { OperationIdempotency } from "./operation-idempotency.ts"
import { operationFingerprint } from "./operation-idempotency.ts"

export interface IssuanceClient {
  readonly getDraft: (id: string) => Promise<DraftInvoice>
  readonly issueDraft: (csrfToken: string, id: string, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly issueInvoice: (csrfToken: string, body: AuthoringDocumentInput, idempotencyKey: string) => Promise<IssuedInvoice>
}

export interface IssuanceEffects {
  /** Runs once, after the invoice exists and while the session still owns the request. */
  readonly onIssued: (invoice: IssuedInvoice, draftId: string | undefined) => void
  /** Runs when an answer is lost: the registries are refreshed so the outcome can be checked by hand. */
  readonly onOutcomeUnknown: (draftId: string | undefined) => void
}

export interface IssuanceDependencies {
  readonly client: IssuanceClient
  readonly idempotency: OperationIdempotency
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
  readonly alive: () => boolean
  readonly effects: IssuanceEffects
}

export type IssuanceOutcome =
  | { readonly kind: "issued"; readonly invoice: IssuedInvoice }
  | { readonly kind: "busy" }
  | { readonly kind: "aborted" }
  | { readonly kind: "error"; readonly error: unknown }

export interface IssuanceRequest {
  readonly draftId: string | undefined
  readonly payload: AuthoringDocumentInput
  /** A save whose create outcome is unknown blocks issuance entirely: issuing an unidentified document could duplicate it. */
  readonly blockedMessage: string | undefined
}

const OPERATION = "issue-invoice"
const CONCURRENT_CHANGE = "Draftul s-a schimbat în altă sesiune. Reîncarcă pagina înainte de emitere."
export const UNCONFIRMED_ISSUE = "Rezultatul emiterii nu este confirmat: factura poate să fi fost deja emisă. Un nou „Emite factura” retrimite exact același document; verifică întâi registrul de facturi."
const UNCONFIRMED_ISSUE_EDITED = "Rezultatul emiterii precedente nu este confirmat, iar documentul s-a schimbat între timp. Nu poate fi retras un răspuns sub o altă cheie: verifică registrul de facturi înainte de a emite din nou."

/** The attempt whose answer never arrived: only an explicit replay of this exact payload may be sent again. */
interface UnconfirmedAttempt {
  readonly key: string
  readonly payloadFingerprint: string
}

/**
 * Issuance, as a plain object so the races can be tested without a DOM.
 *
 * Without a saved draft the document goes straight to `POST /invoices`. From a
 * saved draft the server's copy is read fresh and compared with the intent
 * first — issuing seals whatever the server holds, not whatever this screen
 * shows — and only then is `POST /drafts/{id}/issue` sent.
 *
 * Both endpoints replay by idempotency key. The key is kept across a lost
 * answer (the invoice may already exist; only the server's store can hand it
 * back), and the fresh-draft check deliberately does not block a legitimate
 * replay: a draft that already reads `issued` is exactly what a previous,
 * answer-less attempt looks like from the server's side, so the same key is
 * sent again and the server returns the invoice it already sealed.
 */
export const createInvoiceIssuanceController = (dependencies: IssuanceDependencies) => {
  let inFlight = false
  let unconfirmedAttempt: UnconfirmedAttempt | undefined
  const owns = (started: number): boolean =>
    dependencies.alive() && dependencies.ownsEpoch(started)

  const issue = async (request: IssuanceRequest): Promise<IssuanceOutcome> => {
    if (inFlight) return { kind: "busy" }
    if (request.blockedMessage !== undefined) return { kind: "error", error: new Error(request.blockedMessage) }
    const payloadFingerprint = operationFingerprint(request.payload)
    if (unconfirmedAttempt !== undefined && unconfirmedAttempt.payloadFingerprint !== payloadFingerprint) {
      return { kind: "error", error: new Error(UNCONFIRMED_ISSUE_EDITED) }
    }
    inFlight = true
    try {
      const started = dependencies.epoch()
      const csrfToken = requireCsrf(dependencies.csrfToken())
      if (!owns(started)) return { kind: "aborted" }
      // The fingerprint names the intent: a retry of the same document reuses
      // the key, an edited document cannot replay an older answer.
      const fingerprint = request.draftId === undefined
        ? operationFingerprint(request.payload)
        : `draft\u0000${request.draftId}`
      const key = dependencies.idempotency.current(OPERATION, fingerprint)
      let invoice: IssuedInvoice
      try {
        if (request.draftId === undefined) {
          invoice = await dependencies.client.issueInvoice(csrfToken, request.payload, key)
        } else {
          const fresh = await dependencies.client.getDraft(request.draftId)
          if (!owns(started)) return { kind: "aborted" }
          if (fresh.status === "draft" && !authoringPayloadMatchesDraft(request.payload, fresh)) {
            return { kind: "error", error: new Error(CONCURRENT_CHANGE) }
          }
          invoice = await dependencies.client.issueDraft(csrfToken, request.draftId, key)
        }
      } catch (error) {
        if (!owns(started)) return { kind: "aborted" }
        dependencies.idempotency.fail(OPERATION, fingerprint, error as Error)
        if (isLostResponse(error)) {
          // The answer may exist in the server's idempotency store only: the
          // attempt is kept so a retry replays this exact payload and key,
          // while an edited payload is refused locally rather than issued
          // twice.
          unconfirmedAttempt = { key, payloadFingerprint }
          dependencies.effects.onOutcomeUnknown(request.draftId)
        } else {
          unconfirmedAttempt = undefined
        }
        return { kind: "error", error }
      }
      if (!owns(started)) return { kind: "aborted" }
      unconfirmedAttempt = undefined
      dependencies.idempotency.complete(OPERATION)
      dependencies.effects.onIssued(invoice, request.draftId)
      return { kind: "issued", invoice }
    } finally {
      inFlight = false
    }
  }

  return { issue, unconfirmedIssue: (): string | undefined => unconfirmedAttempt === undefined ? undefined : UNCONFIRMED_ISSUE }
}

export type InvoiceIssuanceController = ReturnType<typeof createInvoiceIssuanceController>
