import type { ReactNode } from "react"

import { Loading } from "./AsyncState.tsx"
import { SessionRecovery } from "./SessionRecovery.tsx"
import { Shell } from "./Shell.tsx"
import type { AuthenticatedShellModel } from "../hooks/use-authenticated-shell.ts"

/**
 * The frame every private screen sits in, and the only thing it renders while
 * the session is anything other than authenticated.
 *
 * Keeping the three session states in one place is what stops a screen from
 * accidentally rendering its own content during `checking` or after the session
 * ended: the children are not reached until the session says so.
 */
export const PrivateScreen = ({ shell, children }: {
  readonly shell: AuthenticatedShellModel
  readonly children: ReactNode
}) => {
  if (shell.status === "restore-error") {
    return <Shell unlocked={false}><SessionRecovery error={shell.error} onRetry={shell.retryRestore} /></Shell>
  }
  if (shell.status !== "authenticated") {
    return <Shell unlocked={false}><Loading label="Verific sesiunea…" /></Shell>
  }
  return <Shell unlocked logoutPending={shell.logoutPending} onLogout={shell.logout}>{children}</Shell>
}
