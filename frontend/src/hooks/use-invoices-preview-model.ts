import { useAuth } from "./auth-context.ts"
import type { AuthStatus } from "../lib/auth-controller.ts"

export interface InvoicesPreviewModel {
  readonly status: AuthStatus
  readonly error: unknown
  readonly logoutPending: boolean
  readonly logout: () => void
  readonly retryRestore: () => void
}

export const useInvoicesPreviewModel = (): InvoicesPreviewModel => {
  const auth = useAuth()
  return {
    status: auth.status,
    error: auth.error,
    logoutPending: auth.logoutPending,
    logout: () => { void auth.logout() },
    retryRestore: () => { void auth.retryRestore() },
  }
}
