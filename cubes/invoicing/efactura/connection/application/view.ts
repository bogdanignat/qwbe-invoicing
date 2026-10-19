import { connectionStatus, refreshExpiryWarning, type ConnectionStatus } from "../domain/connection.ts"
import type { AnafEnvironment } from "../domain/environment.ts"
import type { AttemptRecord, ConnectionRecord } from "./ports.ts"

/** Never a token: the state, the environment, the identity ANAF proved and the user's own unfinished attempt. */
export interface ConnectionView {
  readonly status: ConnectionStatus
  readonly environment: AnafEnvironment
  readonly verifiedCif: string | null
  readonly refreshExpiresAt: string | null
  readonly refreshExpiryWarning: boolean
  readonly connectedBy: string | null
  readonly connectedAt: string | null
  /** `pending`/`expired`: an attempt the user started never came back, so ANAF may have closed the session. */
  readonly attempt: "none" | "pending" | "expired"
}

export interface ViewInput {
  readonly configured: boolean
  readonly environment: AnafEnvironment
  readonly record: ConnectionRecord | undefined
  readonly attempt: AttemptRecord | undefined
  readonly actorId: string
  readonly at: Date
}

const attemptNotice = (attempt: AttemptRecord | undefined, actorId: string, at: Date): ConnectionView["attempt"] => {
  if (attempt === undefined || attempt.consumed || attempt.createdBy !== actorId) return "none"
  return Date.parse(attempt.expiresAt) > at.getTime() ? "pending" : "expired"
}

/** A token pair that no longer opens is as good as none: only the certificate brings the connection back. */
export const connectionView = ({ configured, environment, record, attempt, actorId, at }: ViewInput): ConnectionView => {
  const identity = record?.identity
  const stored = record === undefined ? undefined : {
    status: record.status === "connected" && record.tokens === "unreadable" ? "needs_reconnect" as const : record.status,
    refreshExpiresAt: identity?.refreshExpiresAt,
  }
  return {
    status: connectionStatus(configured, stored, at),
    environment,
    verifiedCif: identity?.verifiedCif ?? null,
    refreshExpiresAt: identity?.refreshExpiresAt ?? null,
    refreshExpiryWarning: identity !== undefined && refreshExpiryWarning(identity.refreshExpiresAt, at),
    connectedBy: identity?.connectedBy ?? null,
    connectedAt: identity?.connectedAt ?? null,
    attempt: attemptNotice(attempt, actorId, at),
  }
}
