import { Effect, type Redacted } from "effect"

import {
  DomainConflict, PermissionDenied, type AuthenticationRequired, type OrganizationContextMissing, type PersistenceFailure,
} from "../../../contracts/failures.ts"
import type { RequestContext, RequestContextProvider } from "../../../contracts/host.ts"
import type { EFacturaPermissions } from "../contracts/permissions.ts"
import { spvCif } from "../domain/callback.ts"
import { OAUTH_ATTEMPT_TTL_SECONDS } from "../domain/connection.ts"
import { connectionAudit } from "./audit.ts"
import type { ConnectionHost, ConnectionTransaction } from "./ports.ts"
import { connectionView, type ConnectionView } from "./view.ts"

export type ConnectionFailure = AuthenticationRequired | OrganizationContextMissing | PermissionDenied | DomainConflict | PersistenceFailure

export interface ConnectionStart {
  readonly authorizeUrl: string
  /** Goes into the attempt cookie and nowhere else. */
  readonly nonce: Redacted.Redacted
}

export interface ConnectionDependencies extends ConnectionHost {
  readonly context: RequestContextProvider
  readonly permissions: EFacturaPermissions
}

const notConfigured = new DomainConflict({ code: "efactura_not_configured", message: "ANAF e-Factura is not configured" })
const issuerCifInvalid = new DomainConflict({ code: "efactura_issuer_cif_invalid", message: "the issuer has no CIF the SPV can check" })

export const createConnectionService = (dependencies: ConnectionDependencies) => {
  const { anaf, clock, environment, permissions, store } = dependencies

  const authorize = (permission: string): Effect.Effect<RequestContext, ConnectionFailure> =>
    Effect.flatMap(dependencies.context.current, (context) =>
      context.identity.permissions.includes(permission) ? Effect.succeed(context) : Effect.fail(new PermissionDenied({ permission })))

  const view = (context: RequestContext): Effect.Effect<ConnectionView, PersistenceFailure> => Effect.gen(function*() {
    const organizationId = context.organization.id
    const now = yield* clock.now
    const [record, attempt] = yield* store.transaction((transaction: ConnectionTransaction) =>
      Effect.all([transaction.findConnection(organizationId), transaction.findAttempt(organizationId)]))
    return connectionView({ configured: anaf !== undefined, environment, record, attempt, actorId: context.identity.id, at: now })
  })

  // The attempt replaces the organization's previous one, which can then never complete.
  const start: Effect.Effect<ConnectionStart, ConnectionFailure> = Effect.gen(function*() {
    const context = yield* authorize(permissions.manageConnection)
    if (anaf === undefined) return yield* Effect.fail(notConfigured)
    const organizationId = context.organization.id
    const actorId = context.identity.id
    const now = yield* clock.now
    const nonce = yield* anaf.newNonce
    yield* store.transaction((transaction) => Effect.gen(function*() {
      // The callback checks the right on this CIF; without one, ANAF would be asked for nothing.
      if (spvCif((yield* transaction.findIssuerFiscalIdentifier(organizationId)) ?? "") === undefined) {
        return yield* Effect.fail(issuerCifInvalid)
      }
      const record = yield* transaction.findConnection(organizationId)
      if (record === undefined) {
        yield* transaction.saveConnection(organizationId, { status: "disconnected", generation: 0, revision: 0, identity: undefined,
          tokens: undefined, updatedBy: actorId, updatedAt: now.toISOString() })
      }
      yield* transaction.saveAttempt({ organizationId, nonceHash: anaf.nonceHash(nonce), generation: record?.generation ?? 0,
        createdBy: actorId, createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + OAUTH_ATTEMPT_TTL_SECONDS * 1000).toISOString() })
    }))
    return { authorizeUrl: anaf.authorizeUrl, nonce }
  })

  // A new generation, so no attempt, callback or refresh begun before it can write; ANAF is told after the commit.
  const disconnect: Effect.Effect<ConnectionView, ConnectionFailure> = Effect.gen(function*() {
    const context = yield* authorize(permissions.manageConnection)
    const organizationId = context.organization.id
    const now = yield* clock.now
    const revocable = yield* store.transaction((transaction) => Effect.gen(function*() {
      const record = yield* transaction.findConnection(organizationId)
      yield* transaction.deleteAttempt(organizationId)
      if (record === undefined) return undefined
      yield* transaction.saveConnection(organizationId, { status: "disconnected", generation: record.generation + 1, revision: 0,
        identity: undefined, tokens: undefined, updatedBy: context.identity.id, updatedAt: now.toISOString() })
      if (record.status === "disconnected") return undefined
      yield* transaction.appendAuditEvent(yield* connectionAudit(dependencies, organizationId, context.identity.id, now, "disconnected"))
      return typeof record.tokens === "object" ? record.tokens.refresh : undefined
    }))
    if (revocable !== undefined && anaf !== undefined) yield* anaf.revoke(revocable)
    return yield* view(context)
  })

  return {
    status: Effect.flatMap(authorize(permissions.read), view),
    start,
    disconnect,
  }
}

export type ConnectionService = ReturnType<typeof createConnectionService>
