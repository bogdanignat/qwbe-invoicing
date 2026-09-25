import { ApiFailure } from "./api-errors.ts"
import { isLostResponse } from "./draft-reconciliation.ts"
import type { RecoveryIntent } from "./operation-recovery-journal.ts"
import { NOT_HYDRATED, RESOLVE_FAILED, isRecoveryConflict, type RecoveryPort } from "./operation-recovery-port.ts"
import type { RecoveryRecord } from "./operation-recovery-types.ts"
import { requireCsrf } from "./require-csrf.ts"

/**
 * One recoverable write, as a sequence: claim the intent in the journal, send
 * it, then settle the key with whatever answer came back.
 *
 * Issuing an invoice, authoring a proforma and converting one are the same risk
 * — a request that may already have created a fiscal document by the time the
 * answer is lost — and therefore the same procedure. Stating it once is what
 * keeps them from drifting: a new conflict code, or a change in the order of
 * `resolve` and `markConflict`, is written here and holds for all of them
 * instead of leaving one caller with an unresolved key in the journal.
 *
 * What differs per caller stays a parameter: the intent, the request itself,
 * the effects that follow, and — for issuance — a read taken before anything is
 * claimed. Nothing here knows what a document is.
 */
export interface RecoverableWriteSession {
  readonly recovery: RecoveryPort
  readonly csrfToken: () => string | undefined
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
  readonly alive: () => boolean
}

export interface RecoverableWrite<TResult, TKnown> {
  /** Written down before the request leaves; its fingerprint is what an unconfirmed retry is compared against. */
  readonly intent: RecoveryIntent
  /** Whatever the caller already knows forbids this write: refused before any request. */
  readonly blockedMessage: string | undefined
  /** The refusal for a retry that no longer carries the document the unconfirmed key belongs to. */
  readonly changedMessage: string
  /**
   * A read taken after the session is checked and before anything is claimed:
   * it returns the refusal it found, or `undefined`. Nothing is written yet, so
   * a read that throws is an ordinary error and leaves no key behind.
   */
  readonly preflight?: () => Promise<string | undefined>
  readonly send: (csrfToken: string, record: RecoveryRecord, replay: boolean) => Promise<TResult>
  /** Runs once, after the document exists and while the session still owns the request. */
  readonly onSettled: (result: TResult) => void
  /** Runs when an answer is lost: the caller refreshes whatever the write could have touched. */
  readonly onOutcomeUnknown: () => void
  /**
   * A settled refusal the caller recognises as a state of the document rather
   * than a failure of this attempt — the key is released either way, and the
   * caller's own outcome is returned instead of an error nobody can retry out of.
   */
  readonly knownState?: (code: string | undefined) => TKnown | undefined
}

export type RecoverableWriteOutcome<TResult, TKnown = never> =
  /** The write is confirmed. `effectsError` says something after it did not run; it never downgrades the result. */
  | { readonly kind: "done"; readonly result: TResult; readonly effectsError?: unknown }
  | { readonly kind: "busy" }
  | { readonly kind: "aborted" }
  | { readonly kind: "error"; readonly error: unknown }
  | TKnown

export interface RecoverableWriter {
  readonly run: <TResult, TKnown = never>(
    write: RecoverableWrite<TResult, TKnown>,
  ) => Promise<RecoverableWriteOutcome<TResult, TKnown>>
  /** Whether an attempt's answer never arrived: the caller turns that into its own wording. */
  readonly unconfirmed: () => boolean
}

const refused = (message: string) => ({ kind: "error", error: new Error(message) }) as const

/**
 * One writer per screen: the single-flight flag and the fingerprint of an
 * attempt whose answer never arrived live in it, so two presses cannot become
 * two documents and an edited retry cannot spend a key that belongs to another.
 */
export const createRecoverableWriter = (session: RecoverableWriteSession): RecoverableWriter => {
  let inFlight = false
  let unconfirmedFingerprint: string | undefined

  const run = async <TResult, TKnown = never>(
    write: RecoverableWrite<TResult, TKnown>,
  ): Promise<RecoverableWriteOutcome<TResult, TKnown>> => {
    if (inFlight) return { kind: "busy" }
    if (write.blockedMessage !== undefined) return refused(write.blockedMessage)
    if (!session.recovery.hydrated()) return refused(NOT_HYDRATED)
    const { fingerprint } = write.intent
    if (unconfirmedFingerprint !== undefined && unconfirmedFingerprint !== fingerprint) {
      return refused(write.changedMessage)
    }
    inFlight = true
    try {
      const started = session.epoch()
      const owns = (): boolean => session.alive() && session.ownsEpoch(started)
      const csrfToken = requireCsrf(session.csrfToken())
      if (!owns()) return { kind: "aborted" }
      if (write.preflight !== undefined) {
        let refusal: string | undefined
        try {
          refusal = await write.preflight()
        } catch (error) {
          return owns() ? { kind: "error", error } : { kind: "aborted" }
        }
        if (!owns()) return { kind: "aborted" }
        if (refusal !== undefined) return refused(refusal)
      }
      const claimed = session.recovery.claim(write.intent)
      if (claimed.kind === "blocked") return refused(claimed.message)
      const { record } = claimed
      let result: TResult
      try {
        result = await write.send(csrfToken, record, claimed.replay)
      } catch (error) {
        if (!owns()) return { kind: "aborted" }
        if (isLostResponse(error)) {
          // The document may exist in the server's idempotency store only: the
          // intent and its key stay, so pressing again replays this exact
          // request while a changed one is refused rather than sent twice.
          unconfirmedFingerprint = fingerprint
          write.onOutcomeUnknown()
          return { kind: "error", error }
        }
        unconfirmedFingerprint = undefined
        const code = error instanceof ApiFailure ? error.code : undefined
        if (code !== undefined && isRecoveryConflict(code)) {
          session.recovery.markConflict(record.key, code)
        } else {
          session.recovery.resolve(record.key)
        }
        return write.knownState?.(code) ?? { kind: "error", error }
      }
      if (!owns()) return { kind: "aborted" }
      unconfirmedFingerprint = undefined
      const cleared = session.recovery.resolve(record.key)
      try {
        write.onSettled(result)
      } catch (effectsError) {
        return { kind: "done", result, effectsError }
      }
      return cleared ? { kind: "done", result } : { kind: "done", result, effectsError: new Error(RESOLVE_FAILED) }
    } finally {
      inFlight = false
    }
  }

  return { run, unconfirmed: () => unconfirmedFingerprint !== undefined }
}
