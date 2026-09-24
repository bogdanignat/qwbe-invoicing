import type { AuthoringDocumentInput, DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import type { RecoveryPort } from "./operation-recovery-port.ts"

/**
 * The controller's surface, stated here rather than inferred from the factory:
 * the types module is what the hooks and the factory both import, so deriving
 * it from the factory would make the two files depend on each other.
 */
export interface InvoiceIssuanceController {
  readonly issue: (request: IssuanceRequest) => Promise<IssuanceOutcome>
  /** The message for an attempt whose answer never arrived, or `undefined` when nothing is pending. */
  readonly unconfirmedIssue: () => string | undefined
}

export interface IssuanceClient {
  readonly getDraft: (id: string) => Promise<DraftInvoice>
  readonly issueDraft: (csrfToken: string, id: string, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly issueInvoice: (csrfToken: string, body: AuthoringDocumentInput, idempotencyKey: string) => Promise<IssuedInvoice>
  /** The stored body, sent as it was sent: a replay is never rebuilt from the current form. */
  readonly replayInvoiceIssuance: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<IssuedInvoice>
}

export interface IssuanceEffects {
  /** Runs once, after the invoice exists and while the session still owns the request. */
  readonly onIssued: (invoice: IssuedInvoice, draftId: string | undefined) => void
  /** Runs when an answer is lost: the registries are refreshed so the outcome can be checked by hand. */
  readonly onOutcomeUnknown: (draftId: string | undefined) => void
}

export interface IssuanceDependencies {
  readonly client: IssuanceClient
  readonly recovery: RecoveryPort
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
  readonly alive: () => boolean
  readonly effects: IssuanceEffects
}

export type IssuanceOutcome =
  /**
   * The invoice exists. `effectsError` says the write is confirmed but
   * something after it was not — a navigation, a cache write, the local
   * warning that would not clear. It never downgrades the result to unknown
   * and never invites a second emission.
   */
  | { readonly kind: "issued"; readonly invoice: IssuedInvoice; readonly effectsError?: unknown }
  | { readonly kind: "busy" }
  | { readonly kind: "aborted" }
  | { readonly kind: "error"; readonly error: unknown }

export interface IssuanceRequest {
  readonly draftId: string | undefined
  readonly payload: AuthoringDocumentInput
  /** A save whose create outcome is unknown blocks issuance entirely: issuing an unidentified document could duplicate it. */
  readonly blockedMessage: string | undefined
}

export const CONCURRENT_CHANGE = "Draftul s-a schimbat în altă sesiune. Reîncarcă pagina înainte de emitere."
export const UNCONFIRMED_ISSUE = "Rezultatul emiterii nu este confirmat: factura poate să fi fost deja emisă. Un nou „Emite factura” retrimite exact același document; verifică întâi registrul de facturi."
export const UNCONFIRMED_ISSUE_EDITED = "Rezultatul emiterii precedente nu este confirmat, iar documentul s-a schimbat între timp. Nu poate fi retras un răspuns sub o altă cheie: verifică registrul de facturi înainte de a emite din nou."
