import {
  decodeJournalEntry, operationOf, RECOVERY_VERSION,
  type JournalEntry, type RecoveryOperation, type RecoveryRecord, type RecoveryRequest, type RecoverySummary,
} from "./operation-recovery-types.ts"

/**
 * The single unresolved write a tab is allowed to have, written down before the
 * request leaves and cleared only by an answer that settles it.
 *
 * One slot, not one per screen and not one per document family: saving a draft,
 * issuing an invoice, issuing a proforma and converting one are the same risk,
 * and two controllers — two mounts, the two halves of a StrictMode rehearsal —
 * must not each believe they hold the only intent. A claim that does not match
 * what is already stored is refused, so a changed document cannot start a
 * second operation while the first is unresolved, and an unresolved proforma
 * write blocks invoice writes exactly as an invoice write blocks a proforma:
 * one unanswered request at a time is the whole point.
 *
 * The scope is the tab and the origin (session storage), which is what a reload
 * has to survive and what must not leak between tabs or outlive the browser
 * session. It is deliberately not a per-user or per-organisation record: this
 * frontend has no such identity to key on, and inventing one would be a lie.
 *
 * Nothing secret is stored — the request body only, never the API token, never
 * the CSRF value — and an auth expiry strips even that, leaving a marker that
 * says only "something was unresolved".
 */
export interface JournalStorage {
  readonly getItem: (key: string) => string | null
  readonly setItem: (key: string, value: string) => void
  readonly removeItem: (key: string) => void
}

export interface RecoveryIntent {
  readonly operation: RecoveryOperation
  readonly request: RecoveryRequest
  readonly fingerprint: string
  readonly summary: RecoverySummary
}

export type ClaimResult =
  /** The record is on disk and the request may leave. A replay of an existing intent returns that same record. */
  | { readonly kind: "claimed"; readonly record: RecoveryRecord; readonly replay: boolean }
  /** Another intent is unresolved, or the storage said something this client cannot act on. Nothing may be sent. */
  | { readonly kind: "blocked"; readonly entry: JournalEntry; readonly message: string }

export interface RecoveryJournal {
  readonly read: () => JournalEntry
  readonly claim: (intent: RecoveryIntent) => ClaimResult
  /** The write is settled and owned by this key: the slot is freed. Returns whether the storage accepted it. */
  readonly resolve: (key: string) => boolean
  /** The server refused this key for good (a reused key, a deleted result): evidence is kept, nothing is retried. */
  readonly markConflict: (key: string, conflict: string) => void
  /** Auth expiry: the payload and the key go, the fact that something is unresolved stays. */
  readonly strip: () => boolean
  /** The user states they checked the registry. The only way a marker or a settled conflict leaves. */
  readonly dismiss: () => boolean
}

export const RECOVERY_SLOT = "qwbe.operation-recovery"

export const BLOCKED_OTHER = "O operație anterioară nu este încă rezolvată. Retrimite-o sau confirmă că ai verificat registrul de facturi și proforme înainte de a începe alta."
export const BLOCKED_CONFLICT = "Operația anterioară a fost refuzată definitiv de server. Verifică registrul de facturi și proforme și închide avertismentul înainte de a continua."
export const BLOCKED_MARKER = "Sesiunea a expirat cu o operație nerezolvată. Verifică registrul de facturi și proforme și închide avertismentul înainte de a scrie din nou."
export const BLOCKED_UNAVAILABLE = "Registrul local de recuperare nu este disponibil, deci o cerere trimisă acum nu ar putea fi recuperată. Nu am trimis nimic."
export const BLOCKED_CORRUPT = "Registrul local de recuperare este deteriorat. Verifică registrul de facturi și proforme și închide avertismentul înainte de a scrie din nou."
/** Not a situation the user created: a caller paired an operation with a request that is not its own. */
export const BLOCKED_MISMATCH = "Cererea nu corespunde operației anunțate, deci nu ar putea fi recuperată corect. Nu am trimis nimic."

interface Dependencies {
  /** Read when it is needed, never at module load: on the server there is no storage to reach for. */
  readonly storage: () => JournalStorage | undefined
  readonly now: () => string
  readonly newKey: () => string
}

export const createRecoveryJournal = (dependencies: Dependencies): RecoveryJournal => {
  const read = (): JournalEntry => {
    const storage = dependencies.storage()
    if (storage === undefined) return { kind: "unavailable" }
    try {
      return decodeJournalEntry(storage.getItem(RECOVERY_SLOT))
    } catch {
      return { kind: "unavailable" }
    }
  }
  const put = (value: unknown): boolean => {
    const storage = dependencies.storage()
    if (storage === undefined) return false
    try {
      storage.setItem(RECOVERY_SLOT, JSON.stringify(value))
      return true
    } catch {
      return false
    }
  }
  const drop = (): boolean => {
    const storage = dependencies.storage()
    if (storage === undefined) return false
    try {
      storage.removeItem(RECOVERY_SLOT)
      return true
    } catch {
      return false
    }
  }
  const held = (key: string): RecoveryRecord | undefined => {
    const entry = read()
    // The ownership guard: a controller may only settle the record it wrote.
    return entry.kind === "record" && entry.record.key === key ? entry.record : undefined
  }

  const claim = (intent: RecoveryIntent): ClaimResult => {
    const entry = read()
    // The pair is checked here and not only when reading back: a record whose
    // operation and request disagree titles one write and replays another, and
    // writing it would mean the mistake is first seen after a reload.
    if (operationOf(intent.request) !== intent.operation) return { kind: "blocked", entry, message: BLOCKED_MISMATCH }
    if (entry.kind === "unavailable") return { kind: "blocked", entry, message: BLOCKED_UNAVAILABLE }
    if (entry.kind === "corrupt") return { kind: "blocked", entry, message: BLOCKED_CORRUPT }
    if (entry.kind === "marker") return { kind: "blocked", entry, message: BLOCKED_MARKER }
    if (entry.kind === "record") {
      const stored = entry.record
      if (stored.state === "conflict") return { kind: "blocked", entry, message: BLOCKED_CONFLICT }
      // The same intent again is a replay, not a new operation: the stored key
      // and the stored request are reused exactly, whatever the form says now.
      if (stored.operation === intent.operation && stored.fingerprint === intent.fingerprint) {
        return { kind: "claimed", record: stored, replay: true }
      }
      return { kind: "blocked", entry, message: BLOCKED_OTHER }
    }
    const record: RecoveryRecord = {
      version: RECOVERY_VERSION, operation: intent.operation, key: dependencies.newKey(),
      request: intent.request, fingerprint: intent.fingerprint, createdAt: dependencies.now(),
      summary: intent.summary, state: "pending",
    }
    // Written before the request leaves: a reload between the two must find the
    // intent, and a storage that refuses it means the request is never sent.
    if (!put(record)) return { kind: "blocked", entry: { kind: "unavailable" }, message: BLOCKED_UNAVAILABLE }
    return { kind: "claimed", record, replay: false }
  }

  return {
    read,
    claim,
    resolve: (key) => held(key) === undefined ? true : drop(),
    markConflict: (key, conflict) => {
      const record = held(key)
      if (record === undefined) return
      put({ ...record, state: "conflict", conflict })
    },
    strip: () => {
      const entry = read()
      if (entry.kind === "marker") return true
      if (entry.kind !== "record") return entry.kind === "empty"
      const marker = { version: RECOVERY_VERSION, kind: "marker", operation: entry.record.operation, createdAt: entry.record.createdAt }
      // The payload must go even if the marker cannot be written; what must
      // never happen is the payload surviving a session that ended.
      return put(marker) || drop()
    },
    dismiss: () => {
      const entry = read()
      if (entry.kind === "record" && entry.record.state === "pending") return false
      return drop()
    },
  }
}
