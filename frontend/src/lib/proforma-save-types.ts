import type { RecoveryPort } from "./operation-recovery-port.ts"
import type { ProformaIdentity } from "./proforma-replay-client.ts"
import type { AuthoringProformaInput } from "./proforma-models.ts"

/**
 * The surface of the proforma authoring controller, stated here so the factory
 * and the hook that wires it import the same declaration instead of each other.
 */
export interface ProformaSaveController {
  readonly save: (request: ProformaSaveRequest) => Promise<ProformaSaveOutcome>
  /** The message for an attempt whose answer never arrived, or `undefined` when nothing is pending. */
  readonly unconfirmedSave: () => string | undefined
}

export interface ProformaSaveClient {
  readonly createProforma: (csrfToken: string, body: AuthoringProformaInput, idempotencyKey: string) => Promise<ProformaIdentity>
  /** The stored body, sent as it was sent: a replay is never rebuilt from the current form. */
  readonly replayProformaIssuance: (csrfToken: string, body: unknown, idempotencyKey: string) => Promise<ProformaIdentity>
}

export interface ProformaSaveEffects {
  /** Runs once, after the proforma exists and while the session still owns the request. */
  readonly onSaved: (proforma: ProformaIdentity) => void
  /** Runs when an answer is lost: the registry is refreshed so the outcome can be checked by hand. */
  readonly onOutcomeUnknown: () => void
}

export interface ProformaSaveDependencies {
  readonly client: ProformaSaveClient
  readonly recovery: RecoveryPort
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
  readonly alive: () => boolean
  readonly effects: ProformaSaveEffects
}

export type ProformaSaveOutcome =
  /**
   * The proforma exists. `effectsError` says the write is confirmed but
   * something after it was not — the navigation, a cache write, the journal
   * slot that would not clear. It never downgrades the result to unknown and
   * never invites a second document.
   */
  | { readonly kind: "saved"; readonly proforma: ProformaIdentity; readonly effectsError?: unknown }
  | { readonly kind: "busy" }
  | { readonly kind: "aborted" }
  | { readonly kind: "error"; readonly error: unknown }

export interface ProformaSaveRequest {
  readonly payload: AuthoringProformaInput
  /** Whatever the screen already refuses for: an unresolved journal entry, a known result. */
  readonly blockedMessage: string | undefined
}

export const UNCONFIRMED_PROFORMA = "Rezultatul emiterii proformei nu este confirmat: proforma poate să fi fost deja creată. O nouă salvare retrimite exact același document; verifică întâi registrul de proforme."
export const UNCONFIRMED_PROFORMA_EDITED = "Rezultatul emiterii precedente nu este confirmat, iar documentul s-a schimbat între timp. Nu poate fi retras un răspuns sub o altă cheie: verifică registrul de proforme înainte de a salva din nou."
