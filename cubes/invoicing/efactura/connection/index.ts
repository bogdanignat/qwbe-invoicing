/**
 * The ANAF OAuth connection of an organization: which environment it talks to,
 * the states the stored connection goes through, the single-use attempt that
 * a callback consumes and the answer of the token endpoint. The cube is pure:
 * tokens are encrypted, stored and exchanged by the host (`kernel/efactura/anaf`).
 * It is required inside the e-Factura plugin, so it is on exactly when e-Factura is.
 */
export const cube = {
  manifest: {
    name: "connection",
    parent: "efactura",
    summary: "ANAF OAuth connection of an organization: environment, token pair state and the single-use attempt",
    required: true,
    tables: ["efactura_connections", "efactura_oauth_attempts"],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { connectionMigrations, type ConnectionMigration } from "./contracts/migrations.ts"
export { ANAF_ENVIRONMENTS, foreignEnvironments, isAnafEnvironment, type AnafEnvironment } from "./domain/environment.ts"
export {
  ACCESS_REFRESH_WINDOW_DAYS, OAUTH_ATTEMPT_TTL_SECONDS, REFRESH_WARNING_DAYS,
  accessRefreshDue, attemptVerdict, connectionStatus, refreshExpiryWarning, tokenAssociatedData,
} from "./domain/connection.ts"
export type {
  AttemptVerdict, ConnectionStatus, OAuthAttempt, StoredConnection, StoredConnectionStatus, TokenBinding, TokenKind,
} from "./domain/connection.ts"
export { classifyTokenReply, type TokenGrant, type TokenReply } from "./domain/token-reply.ts"
