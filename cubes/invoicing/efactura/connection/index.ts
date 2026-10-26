import { efacturaPermissions } from "./contracts/permissions.ts"

/**
 * The ANAF OAuth connection of an organization: which environment it talks to,
 * the states the stored connection goes through, the single-use attempt that
 * a callback consumes, the answer of the token endpoint, and the services that
 * start, complete, show, refresh and end it. The cube is pure: tokens are
 * encrypted, stored and exchanged by the host (`kernel/efactura/anaf`), behind
 * the ports below. It is required inside the e-Factura plugin, so it is on
 * exactly when e-Factura is. Its grants carry the plugin's name.
 */
const permissions = efacturaPermissions("efactura")
export const cube = {
  manifest: {
    name: "connection",
    parent: "efactura",
    summary: "ANAF OAuth connection of an organization: environment, token pair state and the single-use attempt",
    required: true,
    tables: ["efactura_connections", "efactura_oauth_attempts"],
    requiresAuth: true,
    permissions: [permissions.read, permissions.manageConnection].map((name) => ({ name, roles: ["admin"] })),
  },
  create: () => ({ handlers: {} }),
}

export { connectionMigrations, type ConnectionMigration } from "./contracts/migrations.ts"
export { ANAF_ENVIRONMENTS, foreignEnvironments, isAnafEnvironment, type AnafEnvironment } from "./domain/environment.ts"
export {
  ACCESS_REFRESH_WINDOW_DAYS, DAY_MS, OAUTH_ATTEMPT_TTL_SECONDS, REFRESH_WARNING_DAYS,
  accessRefreshDue, attemptVerdict, connectionStatus, refreshExpiryWarning, tokenAssociatedData,
} from "./domain/connection.ts"
export type {
  AttemptVerdict, ConnectionStatus, OAuthAttempt, StoredConnection, StoredConnectionStatus, TokenBinding, TokenKind,
} from "./domain/connection.ts"
export { classifyTokenReply, type TokenGrant, type TokenReply } from "./domain/token-reply.ts"
export { efacturaPermissions, type EFacturaPermissions } from "./contracts/permissions.ts"
export { CALLBACK_OUTCOMES, CALLBACK_TARGET_PATH, REFRESH_TOKEN_DAYS, attemptUntouched, callbackTarget, spvCif, type CallbackOutcome, type CifVerdict } from "./domain/callback.ts"
export { createConnectionService, type ConnectionDependencies, type ConnectionFailure, type ConnectionService, type ConnectionStart } from "./application/connection.ts"
export type { ConnectionView } from "./application/view.ts"
export { completeCallback, type CallbackInput } from "./application/callback.ts"
export { REFRESH_ACTOR, refreshConnection, type RefreshOutcome } from "./application/refresh.ts"
export type {
  AnafGateway, AttemptRecord, ConnectionHost, ConnectionIdentity, ConnectionRecord, ConnectionTransaction, ConnectionWrite, TokenPair,
} from "./application/ports.ts"
