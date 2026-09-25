import type { ClaimResult, RecoveryIntent } from "./operation-recovery-journal.ts"

/**
 * What a write controller is allowed to do with the recovery journal.
 *
 * Narrower than the journal on purpose: a controller may write down an intent,
 * settle its own, and record that the server refused it — it may never strip a
 * record, dismiss a warning, or read somebody else's slot. Those belong to the
 * user's explicit actions and to the auth boundary.
 *
 * `hydrated` is the SSR seam. The journal lives in session storage, which does
 * not exist while the page is rendered on the server, so every write waits for
 * the first client effect: sending before the intent can be written down is
 * exactly the failure this work removes.
 */
export interface RecoveryPort {
  readonly hydrated: () => boolean
  readonly claim: (intent: RecoveryIntent) => ClaimResult
  readonly resolve: (key: string) => boolean
  readonly markConflict: (key: string, conflict: string) => void
}

export const NOT_HYDRATED = "Registrul local de recuperare nu este încă pregătit. Așteaptă o clipă și încearcă din nou."

/** The storage refused to forget a finished write; the next different document stays blocked until it is dismissed. */
export const RESOLVE_FAILED = "Operația s-a încheiat, dar avertismentul local nu a putut fi șters. Închide-l manual înainte de a începe alt document."

export const CONFLICT_REUSED = "idempotency_key_reused"
export const CONFLICT_DELETED = "draft_creation_result_deleted"

/** The two answers that say "this key is spent, and not in your favour": kept as evidence, never retried, never rotated. */
export const isRecoveryConflict = (code: string | undefined): boolean =>
  code === CONFLICT_REUSED || code === CONFLICT_DELETED
