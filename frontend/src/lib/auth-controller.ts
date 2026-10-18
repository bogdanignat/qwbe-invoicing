import { ApiFailure, LogoutUnconfirmedError } from "./api-errors.ts"
import { createSessionEpoch } from "./session-epoch.ts"
import {
  createHeldSession, initialAuthSnapshot, settled, type AuthSessionClient, type AuthSnapshot, type AuthState,
} from "./auth-session.ts"

export interface AuthController {
  readonly mount: () => void
  readonly dispose: () => void
  readonly restore: () => Promise<void>
  readonly login: (token: string) => Promise<void>
  readonly logout: () => Promise<void>
  readonly unauthorized: (epoch: number) => void
  readonly epoch: () => number
  /**
   * Whether the session a caller started in is still the session in place.
   *
   * A request that already left cannot be unsent, so a mutation reads this in
   * its own completion callback: if the session it belonged to has since ended
   * or been replaced, its side effects — a download, a cache write, a redirect
   * — belong to nobody and are dropped rather than applied to whoever is
   * authenticated now.
   */
  readonly ownsEpoch: (epoch: number) => boolean
  readonly csrfToken: () => string | undefined
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

export const createAuthController = (dependencies: Dependencies): AuthController => {
  let state = initialAuthSnapshot
  const held = createHeldSession()
  let generation = 0
  let active: ActiveOperation | undefined
  let mounted = false
  const sessionEpoch = createSessionEpoch()
  const emit = (next: AuthState): void => { state = held.snapshot(next); dependencies.publish(state) }
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
    sessionEpoch.close()
    held.adopt()
    dependencies.clearCache()
    emit(settled("locked"))
    route(dependencies.pathname())
  }
  const restore = (): Promise<void> => begin("restore", async (operation) => {
    emit(settled("checking"))
    try {
      const restored = await dependencies.session.restore(operation.controller.signal)
      if (!current(operation)) return
      sessionEpoch.open()
      held.adopt(restored)
      emit(settled("authenticated"))
      route(dependencies.pathname())
    } catch (error) {
      if (!current(operation)) return
      if (error instanceof ApiFailure && error.status === 401) anonymous()
      else emit(settled("restore-error", error))
    }
  })
  const login = (token: string): Promise<void> => begin("login", async (operation) => {
    emit({ status: "locked", error: undefined, loginPending: true, logoutPending: false })
    try {
      const authenticated = await dependencies.session.login(token, operation.controller.signal)
      if (!current(operation)) return
      sessionEpoch.open()
      held.adopt(authenticated)
      dependencies.clearCache()
      emit(settled("authenticated"))
      route(dependencies.pathname())
    } catch (error) {
      if (!current(operation)) return
      held.adopt()
      emit(settled("locked", error))
    }
  })
  const logout = (): Promise<void> => {
    const token = held.csrfToken()
    if (state.status !== "authenticated" || token === undefined) return Promise.resolve()
    return begin("logout", async (operation) => {
      emit({ status: "authenticated", error: state.error, loginPending: false, logoutPending: true })
      try {
        await dependencies.session.logout(token, operation.controller.signal)
        if (current(operation)) anonymous()
      } catch (error) {
        if (!current(operation)) return
        if (error instanceof ApiFailure && error.status === 401) anonymous()
        else emit(settled("authenticated", new LogoutUnconfirmedError(error)))
      }
    })
  }
  return {
    mount: () => { mounted = true },
    dispose: () => {
      mounted = false; active?.controller.abort(); active = undefined; generation += 1; sessionEpoch.close()
    },
    restore,
    login,
    logout,
    route,
    epoch: sessionEpoch.value,
    ownsEpoch: sessionEpoch.owns,
    csrfToken: held.csrfToken,
    unauthorized: (epoch) => {
      if (!mounted || !sessionEpoch.owns(epoch)) return
      active?.controller.abort(); active = undefined; generation += 1
      anonymous()
    },
  }
}
