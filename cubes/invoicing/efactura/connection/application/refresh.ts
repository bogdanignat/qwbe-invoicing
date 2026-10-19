import { Effect } from "effect"

import type { DomainConflict, PersistenceFailure } from "../../../contracts/failures.ts"
import { connectionAudit } from "./audit.ts"
import type { ConnectionHost, ConnectionRecord, ConnectionTransaction, ConnectionWrite } from "./ports.ts"

/**
 * - `refreshed`: the new pair is stored;
 * - `stale`: the row moved on while ANAF answered (another refresh, a
 *   disconnect, a reconnect), so this answer is dropped;
 * - `needs_reconnect`: the refresh token is refused or no longer opens;
 * - `unavailable`: no usable answer, nothing written, try again later.
 */
export type RefreshOutcome = "refreshed" | "not_connected" | "stale" | "needs_reconnect" | "unavailable"

/** The dispatcher's actor id in the audit trail: nobody asked for a refresh, the schedule did. */
export const REFRESH_ACTOR = "efactura:dispatcher"

type Writer = (current: ConnectionRecord, at: string) => ConnectionWrite

/**
 * One refresh of the organization's token pair. The HTTP call runs outside any
 * transaction; every write is conditioned on the generation and revision
 * observed before it, so an old answer can neither overwrite a newer pair nor
 * mark it for reconnection. Only the dispatcher calls it; requests never do.
 */
export const refreshConnection = (host: ConnectionHost) =>
  (organizationId: string): Effect.Effect<RefreshOutcome, DomainConflict | PersistenceFailure> => Effect.gen(function*() {
    const { anaf, store } = host
    if (anaf === undefined) return "not_connected"
    const observed = yield* store.transaction((transaction) => transaction.findConnection(organizationId))
    if (observed?.status !== "connected") return "not_connected"
    const conditional = (outcome: RefreshOutcome, write: Writer, reason?: string) =>
      conditionalWrite(host, organizationId, observed, outcome, write, reason)
    if (typeof observed.tokens !== "object") return yield* conditional("needs_reconnect", needsReconnect, "token_unreadable")
    const reply = yield* anaf.refresh(observed.tokens.refresh)
    if (reply.kind === "invalid_grant") return yield* conditional("needs_reconnect", needsReconnect, "refresh_refused")
    if (reply.kind !== "granted") return "unavailable"
    const now = yield* host.clock.now
    return yield* conditional("refreshed", (current, at) => ({
      ...current, revision: current.revision + 1, updatedBy: REFRESH_ACTOR, updatedAt: at,
      tokens: { access: reply.grant.accessToken, refresh: reply.grant.refreshToken,
        accessExpiresAt: new Date(now.getTime() + reply.grant.accessExpiresInSeconds * 1000).toISOString() },
    }))
  })

const needsReconnect: Writer = (current, at) =>
  ({ ...current, status: "needs_reconnect", revision: current.revision + 1, tokens: undefined, updatedBy: REFRESH_ACTOR, updatedAt: at })

const conditionalWrite = (
  host: ConnectionHost, organizationId: string, observed: ConnectionRecord, outcome: RefreshOutcome, write: Writer, reason?: string,
) => Effect.gen(function*() {
  const now = yield* host.clock.now
  const audit = outcome === "needs_reconnect"
    ? yield* connectionAudit(host, organizationId, REFRESH_ACTOR, now, "needs_reconnect", reason) : undefined
  return yield* host.store.transaction((transaction: ConnectionTransaction) => Effect.gen(function*() {
    const current = yield* transaction.findConnection(organizationId)
    if (current?.status !== "connected" || current.generation !== observed.generation || current.revision !== observed.revision) {
      return "stale" as const
    }
    yield* transaction.saveConnection(organizationId, write(current, now.toISOString()))
    if (audit !== undefined) yield* transaction.appendAuditEvent(audit)
    return outcome
  }))
})
