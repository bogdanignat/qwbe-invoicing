import { useAuth } from "./auth-context.ts"
import type { AuthStatus } from "../lib/auth-controller.ts"

export interface AuthenticatedShellModel {
  readonly status: AuthStatus
  readonly error: unknown
  readonly logoutPending: boolean
  readonly logout: () => void
  readonly retryRestore: () => void
}

/**
 * What every private screen needs from the session, and nothing more.
 *
 * The screens read the session through this rather than through `useAuth`
 * directly, so a view never holds the transport or the CSRF accessor it has no
 * business calling, and the promise-returning controller actions arrive as
 * plain handlers a button can be given.
 */
export const useAuthenticatedShell = (): AuthenticatedShellModel => {
  const auth = useAuth()
  return {
    status: auth.status,
    error: auth.error,
    logoutPending: auth.logoutPending,
    logout: () => { void auth.logout() },
    retryRestore: () => { void auth.retryRestore() },
  }
}
