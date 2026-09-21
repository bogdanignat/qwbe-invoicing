import { useAuth } from "./auth-context.ts"
import { submitLogin } from "../lib/login-submit.ts"

export interface UnlockViewModel {
  readonly status: "checking" | "locked" | "authenticated" | "restore-error"
  readonly pending: boolean
  readonly error: unknown
  readonly submit: (formData: FormData) => Promise<void>
  readonly retryRestore: () => void
}

export const useUnlockViewModel = (): UnlockViewModel => {
  const auth = useAuth()
  return {
    status: auth.status,
    pending: auth.loginPending,
    error: auth.error,
    submit: (formData) => submitLogin(formData, auth.login),
    retryRestore: () => { void auth.retryRestore() },
  }
}
