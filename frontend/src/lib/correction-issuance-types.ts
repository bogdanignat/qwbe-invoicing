import type { CorrectionDocument, CorrectionInput } from "./document-snapshot.ts"
import type { RecoveryPort } from "./operation-recovery-port.ts"
import type { RecoverySummary } from "./operation-recovery-types.ts"

/**
 * The storno controller's surface, stated here rather than inferred from the
 * factory, so the hook and the factory both import this file instead of each
 * other.
 */
export interface CorrectionIssuanceController {
  readonly issue: (request: CorrectionRequest) => Promise<CorrectionOutcome>
  /** The message for a storno whose answer never arrived, or `undefined` when nothing is pending. */
  readonly unconfirmedIssue: () => string | undefined
}

export interface CorrectionClient {
  readonly createCorrection: (csrfToken: string, invoiceId: string, body: CorrectionInput, idempotencyKey: string) => Promise<CorrectionDocument>
  /** The stored body, sent as it was sent: a replay is never rebuilt from the form. */
  readonly replayCorrection: (csrfToken: string, invoiceId: string, body: unknown, idempotencyKey: string) => Promise<CorrectionDocument>
}

/** The invoice is named per request rather than captured: one controller serves whichever invoice the screen shows. */
export interface CorrectionEffects {
  /** Runs once, after the storno exists and while the session still owns the request. */
  readonly onIssued: (correction: CorrectionDocument, invoiceId: string) => void
  /** Runs when an answer is lost: the invoice is re-read so the outcome can be checked by hand. */
  readonly onOutcomeUnknown: (invoiceId: string) => void
  /** Runs when the server says the invoice already has its storno: the list is re-read to show it. */
  readonly onAlreadyCorrected: (invoiceId: string) => void
}

export interface CorrectionDependencies {
  readonly client: CorrectionClient
  readonly recovery: RecoveryPort
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
  readonly alive: () => boolean
  readonly effects: CorrectionEffects
}

export type CorrectionOutcome =
  /** The storno exists. `effectsError` says something after it failed; it never invites a second storno. */
  | { readonly kind: "issued"; readonly correction: CorrectionDocument; readonly effectsError?: unknown }
  | { readonly kind: "busy" }
  | { readonly kind: "aborted" }
  | { readonly kind: "error"; readonly error: unknown }
  | AlreadyCorrected

/**
 * The one refusal that is a state of the invoice rather than a failure of this
 * attempt: the storno is integral and issued once, and a second request only
 * collects the same 409. The key is settled and the list is re-read.
 */
export interface AlreadyCorrected {
  readonly kind: "already-corrected"
  readonly message: string
}

/** The server's code for a second storno (`cube/invoicing/corrections/application/corrections.ts:37`). */
export const ALREADY_CORRECTED_CODE = "invoice_already_corrected"

export const ALREADY_CORRECTED = "Factura are deja un document storno — aici sau în altă sesiune. Am reîncărcat lista."

export interface CorrectionRequest {
  readonly invoiceId: string
  readonly body: CorrectionInput
  readonly summary: RecoverySummary
  /** Whatever the screen already knows forbids a write: the controller refuses before any request. */
  readonly blockedMessage: string | undefined
}

export const UNCONFIRMED_CORRECTION = "Rezultatul emiterii storno nu este confirmat: documentul poate exista deja. Retrimite exact aceeași cerere din cardul de mai sus sau verifică întâi registrul de facturi."
export const UNCONFIRMED_CORRECTION_CHANGED = "Rezultatul emiterii storno precedente nu este confirmat, iar cererea s-a schimbat între timp. Nu poate fi retras un răspuns sub o altă cheie: verifică registrul de facturi înainte de a încerca din nou."
