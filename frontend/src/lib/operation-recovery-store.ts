import { operationRecoveryJournal } from "./operation-recovery-instance.ts"
import type { RecoveryPort } from "./operation-recovery-port.ts"
import type { JournalEntry } from "./operation-recovery-types.ts"

/**
 * The tab's journal as an external store, which is what it actually is.
 *
 * React may not read session storage while it renders — on the server there is
 * none, and a snapshot rebuilt on every render would never settle — so the slot
 * is read once, cached, and re-read only when something changes it. The server
 * snapshot is deliberately an empty slot: until the first subscription runs on
 * the client nothing is hydrated, and until then every write is refused.
 *
 * The cached entry keeps its identity between changes, which is the contract
 * `useSyncExternalStore` needs; every mutation goes through this module, so
 * there is one place where the cache and the listeners are updated together.
 */
const SERVER_ENTRY: JournalEntry = { kind: "empty" }

const listeners = new Set<() => void>()
let cached: JournalEntry = SERVER_ENTRY
let live = false

const refresh = (): void => {
  cached = operationRecoveryJournal.read()
  for (const listener of listeners) listener()
}

/** The first subscription is the hydration: it happens in an effect, on the client, never on the server. */
export const subscribeRecovery = (listener: () => void): (() => void) => {
  if (!live) {
    live = true
    cached = operationRecoveryJournal.read()
  }
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const recoverySnapshot = (): JournalEntry => cached
export const recoveryServerSnapshot = (): JournalEntry => SERVER_ENTRY
export const recoveryHydrated = (): boolean => live
export const recoveryNotHydrated = (): boolean => false

/** Re-reads the slot after something outside this screen touched it — a logout, most of all. */
export const refreshRecovery = (): void => { refresh() }

/** What the write controllers get: claim, settle their own, record a refusal. Never strip, never dismiss. */
export const operationRecoveryPort: RecoveryPort = {
  hydrated: () => live,
  claim: (intent) => {
    const result = operationRecoveryJournal.claim(intent)
    refresh()
    return result
  },
  resolve: (key) => {
    const cleared = operationRecoveryJournal.resolve(key)
    refresh()
    return cleared
  },
  markConflict: (key, conflict) => {
    operationRecoveryJournal.markConflict(key, conflict)
    refresh()
  },
}

/** The user states they checked the registry: the only way a marker or a settled conflict leaves. */
export const dismissRecovery = (): void => {
  operationRecoveryJournal.dismiss()
  refresh()
}
