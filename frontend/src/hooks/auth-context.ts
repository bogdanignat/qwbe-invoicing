import { createContext, useContext } from "react"

import type { AuthSnapshot } from "../lib/auth-controller.ts"
import type { BrowserTransport } from "../lib/browser-transport.ts"

export interface AuthController extends AuthSnapshot {
  readonly login: (token: string) => Promise<void>
  readonly logout: () => Promise<void>
  readonly retryRestore: () => Promise<void>
  // Data hooks reach the API through the session's own transport, so every 401
  // they provoke is attributed to the session generation that issued it.
  readonly transport: BrowserTransport
  readonly csrfToken: () => string | undefined
  // The session a request is about to leave in, and whether a request that has
  // already returned still belongs to the session in place.
  readonly epoch: () => number
  readonly ownsEpoch: (epoch: number) => boolean
}

export const AuthContext = createContext<AuthController | undefined>(undefined)

export const useAuth = (): AuthController => {
  const value = useContext(AuthContext)
  if (value === undefined) throw new Error("AuthProvider lipsește.")
  return value
}
