"use client"

import { useEffect, useSyncExternalStore } from "react"

import { useAuth } from "./auth-context.ts"
import {
  dismissRecovery, operationRecoveryPort, recoveryHydrated, recoveryNotHydrated,
  recoverySnapshot, recoveryServerSnapshot, refreshRecovery, subscribeRecovery,
} from "../lib/operation-recovery-store.ts"
import type { RecoveryPort } from "../lib/operation-recovery-port.ts"
import type { JournalEntry } from "../lib/operation-recovery-types.ts"

export interface OperationRecoveryModel {
  /** What the tab currently holds; an empty slot until the first client subscription has read the storage. */
  readonly entry: JournalEntry
  readonly hydrated: boolean
  /** What the write controllers are given: claim, resolve, and record a refusal. Nothing else. */
  readonly port: RecoveryPort
  /** The user states they checked the registry. The only way a marker or a settled conflict leaves. */
  readonly dismiss: () => void
}

/**
 * The recovery journal, subscribed to the way an external system has to be.
 *
 * Session storage does not exist while the page is rendered on the server, so
 * the first render knows nothing: `hydrated` is false and every write is
 * refused until the store's first subscription has read the real slot. That is
 * the point — a request that leaves before its intent is written down is the
 * one that cannot be recovered.
 *
 * The slot is re-read whenever the session boundary moves, because a logout
 * strips the record to a marker from outside this screen.
 */
export const useOperationRecovery = (): OperationRecoveryModel => {
  const auth = useAuth()
  const entry = useSyncExternalStore(subscribeRecovery, recoverySnapshot, recoveryServerSnapshot)
  const hydrated = useSyncExternalStore(subscribeRecovery, recoveryHydrated, recoveryNotHydrated)

  useEffect(() => { refreshRecovery() }, [auth.status])

  return { entry, hydrated, port: operationRecoveryPort, dismiss: dismissRecovery }
}
