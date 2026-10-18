import type { AuthenticatedSession, PluginName } from "./api-contracts.ts"

export type AuthStatus = "checking" | "locked" | "authenticated" | "restore-error"
export interface AuthSnapshot {
  readonly status: AuthStatus
  readonly error: unknown
  readonly loginPending: boolean
  readonly logoutPending: boolean
  /** The plugins of the session in place; none outside one. */
  readonly plugins: ReadonlyArray<PluginName>
}
/** A transition as the controller states it; the held session adds its plugins. */
export type AuthState = Omit<AuthSnapshot, "plugins">
export interface AuthSessionClient {
  readonly restore: (signal: AbortSignal) => Promise<AuthenticatedSession>
  readonly login: (token: string, signal: AbortSignal) => Promise<AuthenticatedSession>
  readonly logout: (csrfToken: string, signal: AbortSignal) => Promise<void>
}

/** A snapshot with no operation in flight; every transition here is a settled one. */
export const settled = (status: AuthStatus, error?: unknown): AuthState =>
  ({ status, error, loginPending: false, logoutPending: false })

const NO_PLUGINS: ReadonlyArray<PluginName> = []
export const initialAuthSnapshot: AuthSnapshot = { ...settled("checking"), plugins: NO_PLUGINS }

export interface HeldSession {
  /** Takes the answer of a restore or a login; without one, the session is dropped. */
  readonly adopt: (session?: AuthenticatedSession) => void
  readonly csrfToken: () => string | undefined
  /** Every published snapshot carries the plugins of the session in place. */
  readonly snapshot: (state: AuthState) => AuthSnapshot
}

/**
 * What the session in place holds: its CSRF token and its plugins. They are
 * adopted together and dropped together, so no snapshot outside a session
 * still names a plugin of the one that ended.
 */
export const createHeldSession = (): HeldSession => {
  let csrfToken: string | undefined
  let plugins = NO_PLUGINS
  return {
    adopt: (session) => {
      csrfToken = session?.csrfToken
      plugins = session?.plugins ?? NO_PLUGINS
    },
    csrfToken: () => csrfToken,
    snapshot: (state) => ({ ...state, plugins }),
  }
}
