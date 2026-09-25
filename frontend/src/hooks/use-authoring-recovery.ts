"use client"

import { useOperationRecovery } from "./use-operation-recovery.ts"
import { useOperationReplay } from "./use-operation-replay.ts"
import type { RecoveryPort } from "../lib/operation-recovery-port.ts"
import type { RecoveryRecord } from "../lib/operation-recovery-types.ts"
import { knownResultNotice, recoveryNotice, type RecoveryNoticeModel } from "../lib/operation-recovery-view.ts"

export interface AuthoringRecovery {
  readonly port: RecoveryPort
  readonly notice: RecoveryNoticeModel | undefined
  /** Nothing new may be written: an earlier operation is unresolved, or the journal cannot be read at all. */
  readonly blocked: boolean
  readonly pending: boolean
  readonly error: unknown
  readonly replay: (record: RecoveryRecord) => void
  readonly dismiss: () => void
}

/**
 * The recovery half of an authoring screen: the journal, the explicit replay,
 * and the single answer the rest of the screen needs — whether a new write may
 * leave at all.
 *
 * Blocked while the journal has not hydrated yet, because a request that leaves
 * before its intent is written down is exactly the one that cannot be
 * recovered.
 */
export const useAuthoringRecovery = (): AuthoringRecovery => {
  const recovery = useOperationRecovery()
  const replay = useOperationReplay(recovery.port)
  // A replay that succeeded but could not navigate leaves a clean journal and a
  // screen still holding the same form: the notice names the document that now
  // exists and keeps `blocked` true, so a normal save or issue from here cannot
  // author a second one under a fresh key.
  const notice = recoveryNotice(recovery.entry) ?? knownResultNotice(replay.result)
  return {
    port: recovery.port,
    notice,
    blocked: notice !== undefined || !recovery.hydrated,
    pending: replay.pending,
    error: replay.error,
    replay: replay.replay,
    dismiss: () => { replay.reset(); recovery.dismiss() },
  }
}
