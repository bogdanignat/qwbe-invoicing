/**
 * The shapes the operation recovery journal stores, as types only.
 *
 * Kept apart from the decoder in `operation-recovery-types.ts`, which
 * re-exports them, so the mapping tables and the hostile-input decoding have
 * room of their own; every existing import keeps reading them from there.
 */
/**
 * Every write that must survive a lost answer, invoices and proformas alike.
 *
 * The union is closed and the stored text is matched against it exactly:
 * an operation this build does not know is `corrupt`, never "probably fine".
 */
export type RecoveryOperation =
  | "create-draft"
  | "issue-invoice"
  | "create-proforma"
  | "convert-proforma-invoice"
  | "convert-proforma-draft"
  | "create-correction"

/** What the recovery card shows: enough to recognise the document, never enough to rebuild it. */
export interface RecoverySummary {
  readonly buyerName: string
  readonly series: string
  readonly issueDate: string
  readonly lineCount: number
}

/**
 * The request exactly as it was sent, kept opaque on purpose: a replay resends
 * these bytes, not a payload re-derived from a form the user may have edited
 * since. No token and no CSRF value ever enters it — those belong to the
 * session, and the session is not what is being recovered.
 */
export type RecoveryRequest =
  | { readonly kind: "create-draft"; readonly body: unknown }
  | { readonly kind: "issue-draft"; readonly draftId: string }
  | { readonly kind: "issue-invoice"; readonly body: unknown }
  | { readonly kind: "create-proforma"; readonly body: unknown }
  /** A conversion names the proforma it starts from: the id is part of the path, not of the body. */
  | { readonly kind: "convert-proforma-invoice"; readonly proformaId: string; readonly body: unknown }
  | { readonly kind: "convert-proforma-draft"; readonly proformaId: string; readonly body: unknown }
  /** A storno names the invoice it reverses: the id is part of the path, not of the body. */
  | { readonly kind: "create-correction"; readonly invoiceId: string; readonly body: unknown }

export interface RecoveryRecord {
  readonly version: 1
  readonly operation: RecoveryOperation
  readonly key: string
  readonly request: RecoveryRequest
  readonly fingerprint: string
  readonly createdAt: string
  readonly summary: RecoverySummary
  /** `conflict` preserves a refusal the server settled: evidence to read, never a key to rotate. */
  readonly state: "pending" | "conflict"
  readonly conflict?: string
}

/** What survives an auth expiry: that something is unresolved, and nothing else. */
export interface RecoveryMarker {
  readonly version: 1
  readonly operation: RecoveryOperation
  readonly createdAt: string
}

export type JournalEntry =
  | { readonly kind: "empty" }
  | { readonly kind: "record"; readonly record: RecoveryRecord }
  | { readonly kind: "marker"; readonly marker: RecoveryMarker }
  | { readonly kind: "corrupt" }
  | { readonly kind: "unavailable" }

export const RECOVERY_VERSION = 1
