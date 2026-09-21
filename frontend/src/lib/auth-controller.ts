import { ApiFailure } from "./api-errors.ts"
import type { AuthenticatedSession } from "./api-contracts.ts"

export type AuthStatus = "checking" | "locked" | "authenticated" | "restore-error"
export interface AuthSnapshot {
  readonly status: AuthStatus
  readonly error: unknown
  readonly loginPending: boolean
  readonly logoutPending: boolean
}
export interface AuthSessionClient {
  readonly restore: (signal: AbortSignal) => Promise<AuthenticatedSession>
  readonly login: (token: string, signal: AbortSignal) => Promise<AuthenticatedSession>
  readonly logout: (csrfToken: string, signal: AbortSignal) => Promise<void>
}
export interface AuthController {
  readonly mount: () => void
  readonly dispose: () => void
  readonly restore: () => Promise<void>
  readonly login: (token: string) => Promise<void>
  readonly logout: () => Promise<void>
  readonly unauthorized: () => void
  readonly route: (pathname: string) => void
}
interface Dependencies {
  readonly session: AuthSessionClient
  readonly publish: (snapshot: AuthSnapshot) => void
  readonly clearCache: () => void
  readonly navigate: (path: "/unlock" | "/invoices") => void
  readonly pathname: () => string
}
interface ActiveOperation {
  readonly id: number
  readonly kind: "restore" | "login" | "logout"
  readonly controller: AbortController
  promise: Promise<void>
}

export const initialAuthSnapshot: AuthSnapshot = {
  status: "checking", error: undefined, loginPending: false, logoutPending: false,
}

export class LogoutUnconfirmedError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : ""
    super(`Serverul nu a confirmat ieșirea; sesiunea poate rămâne activă.${detail}`)
    this.name = "LogoutUnconfirmedError"
  }
}

export const createAuthController = (dependencies: Dependencies): AuthController => {
  let state = initialAuthSnapshot
  let csrfToken: string | undefined
  let generation = 0
  let active: ActiveOperation | undefined
  let mounted = false
  const emit = (next: AuthSnapshot): void => { state = next; dependencies.publish(next) }
  const current = (operation: ActiveOperation): boolean =>
    mounted && active === operation && generation === operation.id && !operation.controller.signal.aborted
  const route = (pathname: string): void => {
    if (state.status === "authenticated" && pathname === "/unlock") dependencies.navigate("/invoices")
    if (state.status === "locked" && pathname !== "/unlock") dependencies.navigate("/unlock")
  }
  const begin = (
    kind: ActiveOperation["kind"],
    work: (operation: ActiveOperation) => Promise<void>,
  ): Promise<void> => {
    if (active?.kind === kind) return active.promise
    active?.controller.abort()
    generation += 1
    const operation: ActiveOperation = {
      id: generation, kind, controller: new AbortController(), promise: Promise.resolve(),
    }
    active = operation
    operation.promise = work(operation).finally(() => { if (active === operation) active = undefined })
    return operation.promise
  }
  const anonymous = (): void => {
    csrfToken = undefined
    dependencies.clearCache()
    emit({ status: "locked", error: undefined, loginPending: false, logoutPending: false })
    route(dependencies.pathname())
  }
  const restore = (): Promise<void> => begin("restore", async (operation) => {
    emit({ status: "checking", error: undefined, loginPending: false, logoutPending: false })
    try {
      const restored = await dependencies.session.restore(operation.controller.signal)
      if (!current(operation)) return
      csrfToken = restored.csrfToken
      emit({ status: "authenticated", error: undefined, loginPending: false, logoutPending: false })
      route(dependencies.pathname())
    } catch (error) {
      if (!current(operation)) return
      if (error instanceof ApiFailure && error.status === 401) anonymous()
      else emit({ status: "restore-error", error, loginPending: false, logoutPending: false })
    }
  })
  const login = (token: string): Promise<void> => begin("login", async (operation) => {
    emit({ status: "locked", error: undefined, loginPending: true, logoutPending: false })
    try {
      const authenticated = await dependencies.session.login(token, operation.controller.signal)
      if (!current(operation)) return
      csrfToken = authenticated.csrfToken
      dependencies.clearCache()
      emit({ status: "authenticated", error: undefined, loginPending: false, logoutPending: false })
      route(dependencies.pathname())
    } catch (error) {
      if (!current(operation)) return
      csrfToken = undefined
      emit({ status: "locked", error, loginPending: false, logoutPending: false })
    }
  })
  const logout = (): Promise<void> => begin("logout", async (operation) => {
    emit({ status: "authenticated", error: state.error, loginPending: false, logoutPending: true })
    try {
      if (csrfToken === undefined) throw new Error("Sesiunea locală nu are un token CSRF valid.")
      await dependencies.session.logout(csrfToken, operation.controller.signal)
      if (current(operation)) anonymous()
    } catch (error) {
      if (!current(operation)) return
      if (error instanceof ApiFailure && error.status === 401) anonymous()
      else emit({ status: "authenticated", error: new LogoutUnconfirmedError(error), loginPending: false, logoutPending: false })
    }
  })
  return {
    mount: () => { mounted = true },
    dispose: () => { mounted = false; active?.controller.abort(); active = undefined; generation += 1 },
    restore,
    login,
    logout,
    route,
    unauthorized: () => {
      if (!mounted) return
      active?.controller.abort(); active = undefined; generation += 1
      anonymous()
    },
  }
}
