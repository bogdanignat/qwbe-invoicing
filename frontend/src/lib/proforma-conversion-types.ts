import type { DraftInvoice } from "./draft-models.ts"
import type { IssuedInvoice } from "./document-snapshot.ts"
import type { RecoveryPort } from "./operation-recovery-port.ts"
import type { RecoverySummary } from "./operation-recovery-types.ts"
import type { ConversionTerms } from "./proforma-conversion.ts"

/**
 * The conversion controller's surface, stated here rather than inferred from the
 * factory, so the hook and the factory both import this file instead of each
 * other.
 */
export interface ProformaConversionController {
  readonly convert: (request: ConversionRequest) => Promise<ConversionOutcome>
  /** The message for a conversion whose answer never arrived, or `undefined` when nothing is pending. */
  readonly unconfirmedConversion: () => string | undefined
}

export interface ConversionClient {
  readonly convertToInvoice: (csrfToken: string, proformaId: string, invoiceSeries: string, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly convertToDraft: (csrfToken: string, proformaId: string, invoiceSeries: string, idempotencyKey: string) => Promise<DraftInvoice>
  /** The stored body, sent as it was sent: a replay is never rebuilt from the current selection. */
  readonly replayInvoiceFromProforma: (csrfToken: string, proformaId: string, body: unknown, idempotencyKey: string) => Promise<IssuedInvoice>
  readonly replayDraftFromProforma: (csrfToken: string, proformaId: string, body: unknown, idempotencyKey: string) => Promise<DraftInvoice>
}

export type ConversionResult =
  | { readonly kind: "invoice"; readonly invoice: IssuedInvoice }
  | { readonly kind: "draft"; readonly draft: DraftInvoice }

/**
 * The proforma is named on the way out rather than captured when the controller
 * is built: one screen can move from one proforma to the next without being
 * rebuilt, and a callback that closed over the first id would then stale the
 * wrong document.
 */
export interface ConversionEffects {
  /** Runs once, after the document exists and while the session still owns the request. */
  readonly onConverted: (result: ConversionResult, proformaId: string) => void
  /** Runs when an answer is lost: the registries are refreshed so the outcome can be checked by hand. */
  readonly onOutcomeUnknown: (proformaId: string) => void
  /**
   * Runs when the server says the proforma is already converted: the document
   * is re-read so the screen can offer what it became instead of the same
   * refused request.
   */
  readonly onAlreadyConverted: (proformaId: string) => void
}

export interface ConversionDependencies {
  readonly client: ConversionClient
  readonly recovery: RecoveryPort
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
  readonly alive: () => boolean
  readonly effects: ConversionEffects
}

export type ConversionOutcome =
  /**
   * The document exists. `effectsError` says the write is confirmed but
   * something after it was not — a navigation, a cache write. It never
   * downgrades the result to unknown and never invites a second conversion.
   */
  | { readonly kind: "converted"; readonly result: ConversionResult; readonly effectsError?: unknown }
  | { readonly kind: "busy" }
  | { readonly kind: "aborted" }
  | { readonly kind: "error"; readonly error: unknown }
  | AlreadyConverted

/**
 * The one refusal that is a state of the document rather than a failure of this
 * attempt: a proforma is converted once, and the second answer says so. The key
 * is settled, the document is re-read, and what the proforma became is offered
 * as a link — a retry would only collect the same 409.
 */
export interface AlreadyConverted {
  readonly kind: "already-converted"
  readonly message: string
}

/** The server's code for a second conversion (`cube/invoicing/issuance/application/proforma-conversion-context.ts:13`). */
export const ALREADY_CONVERTED_CODE = "proforma_already_converted"

export const ALREADY_CONVERTED = "Proforma a fost deja convertită — aici sau în altă sesiune. Am reîncărcat documentul: deschide factura sau draftul rezultat de mai sus."

export interface ConversionRequest extends ConversionTerms {
  readonly proformaId: string
  readonly invoiceSeries: string
  readonly summary: RecoverySummary
  /** Whatever the screen already knows forbids a write: the controller refuses before any request. */
  readonly blockedMessage: string | undefined
}

export const UNCONFIRMED_CONVERSION = "Rezultatul conversiei nu este confirmat: documentul poate exista deja. O nouă apăsare retrimite exact aceeași cerere; verifică întâi registrul de facturi și drafturile."
export const UNCONFIRMED_CONVERSION_CHANGED = "Rezultatul conversiei precedente nu este confirmat, iar cererea s-a schimbat între timp. Nu poate fi retras un răspuns sub o altă cheie: verifică registrul de facturi și drafturile înainte de a încerca din nou."
