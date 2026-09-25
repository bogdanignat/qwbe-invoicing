import { useQueryClient } from "@tanstack/react-query"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import type { AuthController as AuthViewController } from "./auth-context.ts"
import { createAuthController, initialAuthSnapshot } from "../lib/auth-controller.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import { operationRecoveryJournal } from "../lib/operation-recovery-instance.ts"
import { resetSessionCache } from "../lib/session-cache.ts"
import { createSessionClient } from "../lib/session-client.ts"

export const useAuthController = (): AuthViewController => {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState(initialAuthSnapshot)
  const { controller, transport } = useMemo(() => {
    let unauthorized: (epoch: number) => void = () => undefined
    let epoch = (): number => 0
    const created = createBrowserTransport({ epoch: () => epoch(), onUnauthorized: (started) => { unauthorized(started) } })
    const auth = createAuthController({
      session: createSessionClient(created),
      publish: setState,
      // A session boundary also strips the recovery journal: the stored request
      // and its key leave with the session, while the fact that something was
      // unresolved stays behind as a marker nobody can silently purge.
      clearCache: () => {
        resetSessionCache(queryClient)
        operationRecoveryJournal.strip()
      },
      navigate: (path) => { router.replace(path) },
      pathname: () => window.location.pathname,
    })
    unauthorized = auth.unauthorized
    epoch = auth.epoch
    return { controller: auth, transport: created }
  }, [queryClient, router])

  useEffect(() => {
    controller.mount()
    void controller.restore()
    return controller.dispose
  }, [controller])
  useEffect(() => { controller.route(pathname) }, [controller, pathname, state.status])

  return {
    ...state,
    login: controller.login,
    logout: controller.logout,
    retryRestore: controller.restore,
    transport,
    csrfToken: controller.csrfToken,
    epoch: controller.epoch,
    ownsEpoch: controller.ownsEpoch,
  }
}
