import { useQueryClient } from "@tanstack/react-query"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"

import type { AuthController as AuthViewController } from "./auth-context.ts"
import { createAuthController, initialAuthSnapshot } from "../lib/auth-controller.ts"
import { createBrowserTransport } from "../lib/browser-transport.ts"
import { createSessionClient } from "../lib/session-client.ts"

export const useAuthController = (): AuthViewController => {
  const queryClient = useQueryClient()
  const router = useRouter()
  const pathname = usePathname()
  const [state, setState] = useState(initialAuthSnapshot)
  const controller = useMemo(() => {
    let unauthorized = (): void => undefined
    const transport = createBrowserTransport({ onUnauthorized: () => { unauthorized() } })
    const created = createAuthController({
      session: createSessionClient(transport),
      publish: setState,
      clearCache: () => { queryClient.clear() },
      navigate: (path) => { router.replace(path) },
      pathname: () => window.location.pathname,
    })
    unauthorized = created.unauthorized
    return created
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
  }
}
