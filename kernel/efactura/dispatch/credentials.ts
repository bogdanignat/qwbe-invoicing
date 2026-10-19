import { Effect, type Redacted } from "effect"

import {
  accessRefreshDue, connectionStatus, refreshConnection, type ConnectionHost, type ConnectionRecord,
} from "../../../cubes/invoicing/efactura/connection/index.ts"

export interface AccessToken {
  readonly access: Redacted.Redacted
  /** The pair it belongs to, `generation:revision`. */
  readonly pair: string
  /** The CIF ANAF proved this connection for: only that CIF's submissions may leave with it. */
  readonly verifiedCif: string
}

/** The stored pair while the connection is usable; never refreshed here. */
export const usableToken = (record: ConnectionRecord | undefined, at: Date): (AccessToken & { readonly expiresAt: string }) | undefined => {
  const identity = record?.identity
  if (record === undefined || identity === undefined || typeof record.tokens !== "object" || record.accessExpiresAt === undefined) return undefined
  if (connectionStatus(true, { status: record.status, refreshExpiresAt: identity.refreshExpiresAt }, at) !== "connected") return undefined
  return { access: record.tokens.access, pair: `${String(record.generation)}:${String(record.revision)}`, verifiedCif: identity.verifiedCif,
    expiresAt: record.accessExpiresAt }
}

/**
 * The dispatcher's access tokens. It is the only refresher: ahead of time when
 * the access token has less than 7 days left, and once after ANAF refuses a
 * token with 401/403. A pair that a refusal already replaced is never
 * refreshed again on the next refusal, so a token ANAF keeps refusing cannot
 * turn into a loop of refreshes; the next scheduled or proactive one decides.
 */
export const dispatcherCredentials = (host: ConnectionHost, now: () => Date) => {
  const replacedAfterRefusal = new Map<string, string>()
  const read = (organizationId: string) => host.store.transaction((transaction) => transaction.findConnection(organizationId)).pipe(
    Effect.map((record) => usableToken(record, now())), Effect.orElseSucceed(() => undefined))
  const refresh = (organizationId: string) => refreshConnection(host)(organizationId).pipe(Effect.orElseSucceed(() => "unavailable" as const))
  const refused = (organizationId: string, token: AccessToken): Effect.Effect<boolean> => Effect.gen(function*() {
    if (replacedAfterRefusal.get(organizationId) === token.pair) return false
    if ((yield* refresh(organizationId)) !== "refreshed") return false
    const next = yield* read(organizationId)
    if (next === undefined) return false
    replacedAfterRefusal.set(organizationId, next.pair)
    return true
  })

  return {
    /** A usable access token of the organization, or `undefined` while it is not connected. */
    token: (organizationId: string): Effect.Effect<AccessToken | undefined> => Effect.gen(function*() {
      const current = yield* read(organizationId)
      if (current === undefined || !accessRefreshDue(current.expiresAt, now())) return current
      yield* refresh(organizationId)
      return yield* read(organizationId)
    }),
    /** After ANAF refused `token`: whether a fresh pair is now stored to try with. */
    refused,
    /** A request was refused with the stored pair and asked for a refresh: the same one-refresh-per-refusal rule. */
    requested: (organizationId: string): Effect.Effect<void> => Effect.gen(function*() {
      const current = yield* read(organizationId)
      if (current !== undefined) yield* refused(organizationId, current)
    }),
  }
}

export type DispatcherCredentials = ReturnType<typeof dispatcherCredentials>
