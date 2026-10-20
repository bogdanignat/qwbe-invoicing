import type { Effect, Redacted } from "effect"

import type { DomainConflict, PersistenceFailure } from "../../../contracts/failures.ts"
import type { Clock, IdGenerator, TransactionalStore } from "../../../contracts/host.ts"
import type { AuditEvent } from "../../../domain/invoice.ts"
import type { CifVerdict } from "../domain/callback.ts"
import type { StoredConnectionStatus } from "../domain/connection.ts"
import type { AnafEnvironment } from "../domain/environment.ts"
import type { TokenReply } from "../domain/token-reply.ts"

type Read<Value> = Effect.Effect<Value, PersistenceFailure>
type Write = Effect.Effect<void, DomainConflict | PersistenceFailure>

export interface TokenPair {
  readonly access: Redacted.Redacted
  readonly refresh: Redacted.Redacted
}

/** Who connected, which CIF ANAF proved, and when the refresh token lapses. Absent while disconnected. */
export interface ConnectionIdentity {
  readonly verifiedCif: string
  readonly connectedBy: string
  readonly connectedAt: string
  readonly refreshExpiresAt: string
}

/**
 * The organization's row. `generation` changes with every connect and
 * disconnect, `revision` with every write of the token pair inside one
 * generation: a write conditioned on both cannot land on a newer pair.
 */
export interface ConnectionRecord {
  readonly status: StoredConnectionStatus
  readonly generation: number
  readonly revision: number
  readonly identity: ConnectionIdentity | undefined
  readonly accessExpiresAt: string | undefined
  /** Opened by the host; `unreadable` when the ciphertext does not open (another key, client, environment or generation). */
  readonly tokens: TokenPair | "unreadable" | undefined
}

export interface ConnectionWrite {
  readonly status: StoredConnectionStatus
  readonly generation: number
  readonly revision: number
  readonly identity: ConnectionIdentity | undefined
  /** Sealed by the host under this row's organization, the configured environment and client, and `generation`. */
  readonly tokens: (TokenPair & { readonly accessExpiresAt: string }) | undefined
  readonly updatedBy: string
  readonly updatedAt: string
}

/** The organization's one current attempt; a new one replaces it. Only the nonce's sha256 is stored. */
export interface AttemptRecord {
  readonly organizationId: string
  readonly nonceHash: string
  /** The connection's generation when the attempt started. */
  readonly generation: number
  readonly consumed: boolean
  readonly createdBy: string
  readonly createdAt: string
  readonly expiresAt: string
}

export interface ConnectionTransaction {
  readonly findConnection: (organizationId: string) => Read<ConnectionRecord | undefined>
  readonly saveConnection: (organizationId: string, connection: ConnectionWrite) => Write
  readonly findAttempt: (organizationId: string) => Read<AttemptRecord | undefined>
  readonly findAttemptByHash: (nonceHash: string) => Read<AttemptRecord | undefined>
  /** Replaces the organization's attempt with a new, unconsumed one. */
  readonly saveAttempt: (attempt: Omit<AttemptRecord, "consumed">) => Write
  /** Fails unless it flips exactly this unconsumed attempt. */
  readonly consumeAttempt: (organizationId: string, nonceHash: string) => Write
  readonly deleteAttempt: (organizationId: string) => Write
  /** The issuer's fiscal identifier as configured, `RO` prefix and all. */
  readonly findIssuerFiscalIdentifier: (organizationId: string) => Read<string | undefined>
  readonly appendAuditEvent: (event: AuditEvent) => Write
}

/**
 * ANAF's OAuth client, as the host configured it. None of these fail: a call
 * that has no usable answer is `unrecognized` or `failed`, and a revoke is best effort.
 */
export interface AnafGateway {
  /** `authorize` with `response_type`, `client_id`, `redirect_uri` and `token_content_type`; never `state` or `scope`. */
  readonly authorizeUrl: string
  readonly newNonce: Effect.Effect<Redacted.Redacted>
  readonly nonceHash: (nonce: Redacted.Redacted) => string
  readonly exchangeCode: (code: Redacted.Redacted) => Effect.Effect<TokenReply>
  readonly refresh: (refreshToken: Redacted.Redacted) => Effect.Effect<TokenReply>
  readonly revoke: (refreshToken: Redacted.Redacted) => Effect.Effect<void>
  /** `listaMesajePaginatieFactura` for the day before `at`, page 1: read-only. */
  readonly verifyCif: (accessToken: Redacted.Redacted, cif: string, at: Date) => Effect.Effect<CifVerdict>
}

/** What every connection operation runs on. `anaf` is `undefined` while e-Factura is not configured. */
export interface ConnectionHost {
  readonly clock: Clock
  readonly ids: IdGenerator
  readonly store: TransactionalStore<ConnectionTransaction>
  readonly anaf: AnafGateway | undefined
  readonly environment: AnafEnvironment
}
