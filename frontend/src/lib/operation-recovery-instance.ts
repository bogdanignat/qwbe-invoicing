import { createRecoveryJournal, type JournalStorage } from "./operation-recovery-journal.ts"

/**
 * The tab's journal, as one instance.
 *
 * One slot per tab means one owner of that slot: two screens, two controllers
 * or the two halves of a StrictMode rehearsal must see the same unresolved
 * write, and the auth boundary must be able to strip it without knowing which
 * screen is mounted.
 *
 * Nothing here touches the browser at module load. The storage is fetched when
 * a read or a write asks for it, so importing this from a component that also
 * renders on the server is safe, and a browser that refuses session storage
 * (private mode, a blocked origin) is reported as unavailable instead of
 * throwing on the way in.
 */
const sessionStorageAccess = (): JournalStorage | undefined => {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage
  } catch {
    return undefined
  }
}

export const operationRecoveryJournal = createRecoveryJournal({
  storage: sessionStorageAccess,
  now: () => new Date().toISOString(),
  newKey: () => crypto.randomUUID(),
})
