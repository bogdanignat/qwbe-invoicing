import { createContext, useContext } from "react"

import type { AuthSnapshot } from "../lib/auth-controller.ts"

export interface AuthController extends AuthSnapshot {
  readonly login: (token: string) => Promise<void>
  readonly logout: () => Promise<void>
  readonly retryRestore: () => Promise<void>
}

export const AuthContext = createContext<AuthController | undefined>(undefined)

export const useAuth = (): AuthController => {
  const value = useContext(AuthContext)
  if (value === undefined) throw new Error("AuthProvider lipsește.")
  return value
}
