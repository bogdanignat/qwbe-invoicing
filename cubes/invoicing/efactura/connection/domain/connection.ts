import type { AnafEnvironment } from "./environment.ts"

/**
 * The connection of one organization to ANAF, as the stored row and the
 * configuration see it together. `not_configured` is the configuration's
 * answer (no client); the other three are the row's.
 */
export type ConnectionStatus = "not_configured" | "disconnected" | "connected" | "needs_reconnect"
export type StoredConnectionStatus = Exclude<ConnectionStatus, "not_configured">

export interface StoredConnection {
  readonly status: StoredConnectionStatus
  /** ISO instant; present while connected or waiting for a reconnect. */
  readonly refreshExpiresAt?: string | undefined
}

const DAY_MS = 24 * 60 * 60 * 1000
/** The access token is refreshed ahead of time when it expires within this window. */
export const ACCESS_REFRESH_WINDOW_DAYS = 7
/** Settings warn about the refresh token this long before it lapses. */
export const REFRESH_WARNING_DAYS = 30
/** An OAuth attempt lives ten minutes and is used once. */
export const OAUTH_ATTEMPT_TTL_SECONDS = 600

export const connectionStatus = (configured: boolean, stored: StoredConnection | undefined, at: Date): ConnectionStatus => {
  if (!configured) return "not_configured"
  if (stored === undefined) return "disconnected"
  // A lapsed refresh token cannot be renewed: only the certificate brings the connection back.
  if (stored.status === "connected" && stored.refreshExpiresAt !== undefined && Date.parse(stored.refreshExpiresAt) <= at.getTime()) {
    return "needs_reconnect"
  }
  return stored.status
}

const within = (instant: string, days: number, at: Date): boolean => Date.parse(instant) - at.getTime() < days * DAY_MS

export const accessRefreshDue = (accessExpiresAt: string, at: Date): boolean => within(accessExpiresAt, ACCESS_REFRESH_WINDOW_DAYS, at)

export const refreshExpiryWarning = (refreshExpiresAt: string, at: Date): boolean => within(refreshExpiresAt, REFRESH_WARNING_DAYS, at)

export interface OAuthAttempt {
  readonly consumed: boolean
  readonly expiresAt: string
}

/** Whether a callback may consume the organization's current attempt; anything but `usable` ends the flow. */
export type AttemptVerdict = "usable" | "missing" | "expired" | "consumed"

export const attemptVerdict = (attempt: OAuthAttempt | undefined, at: Date): AttemptVerdict => {
  if (attempt === undefined) return "missing"
  if (attempt.consumed) return "consumed"
  return Date.parse(attempt.expiresAt) > at.getTime() ? "usable" : "expired"
}

export type TokenKind = "access" | "refresh"

export interface TokenBinding {
  readonly kind: TokenKind
  readonly organizationId: string
  readonly environment: AnafEnvironment
  readonly clientId: string
  readonly generation: number
}

/**
 * The associated data a token is sealed under. A ciphertext copied to another
 * organization, environment, client, generation or to the other token's column
 * does not open, so it reads as `needs_reconnect` instead of being used.
 */
export const tokenAssociatedData = (binding: TokenBinding): string =>
  ["efactura", binding.kind, binding.organizationId, binding.environment, binding.clientId, String(binding.generation)].join(":")
