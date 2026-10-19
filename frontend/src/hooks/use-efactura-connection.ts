import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { useAuth } from "./auth-context.ts"
import { efacturaConnectionQuery } from "./efactura-queries.ts"
import { retryAction } from "./use-document-detail.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { SESSION_CLOSED } from "./use-registry-writes.ts"
import { callbackCode, callbackNotice, withoutCallbackCode, type CallbackNotice } from "../lib/efactura-callback.ts"
import { efacturaQueryKeys } from "../lib/efactura-client.ts"
import { connectionView, DISCONNECT_CONFIRM, type EFacturaConnectionView } from "../lib/efactura-connection.ts"
import { efacturaFailure } from "../lib/efactura-feedback.ts"
import { pluginActive } from "../lib/plugins.ts"
import { sessionWrite } from "../lib/session-write.ts"

export interface EFacturaConnectionModel {
  readonly view: EFacturaConnectionView | undefined
  readonly isPending: boolean
  /** The read failed and there is nothing to show. */
  readonly error: Error | undefined
  readonly retry: (() => void) | undefined
  /** A refused or failed connect or disconnect, already in Romanian. */
  readonly failure: Error | undefined
  /** What ANAF's callback said (`?anaf=`), read once when the screen opened. */
  readonly notice: CallbackNotice | undefined
  readonly pending: boolean
  readonly connect: () => void
  readonly disconnect: () => void
}

/**
 * Setări → Integrări → e-Factura: the connection read, „Conectează” and
 * „Deconectează”. Connecting is a top-level navigation to ANAF's `authorize`
 * URL (the attempt cookie is already set by `start`), and ANAF's callback
 * brings the browser back here with `?anaf=<code>`: the code becomes a notice
 * once and leaves the address at once. With the plugin off nothing is read and
 * there is no model.
 */
export const useEFacturaConnection = (): EFacturaConnectionModel | undefined => {
  const auth = useAuth()
  const enabled = pluginActive(auth, "efactura")
  const { efactura } = useInvoicingClients()
  const queryClient = useQueryClient()
  const read = useQuery(efacturaConnectionQuery(efactura, enabled))
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const navigate = useNavigate()
  const [notice, setNotice] = useState(() => {
    const code = callbackCode(searchStr)
    return code === undefined ? undefined : callbackNotice(code)
  })

  useEffect(() => {
    if (callbackCode(searchStr) === undefined) return
    void navigate({ href: `/settings/integrations${withoutCallbackCode(searchStr)}`, replace: true, resetScroll: false })
  }, [searchStr, navigate])

  const connect = useMutation({
    mutationFn: async () => (await sessionWrite(auth, (token) => efactura.startConnection(token), SESSION_CLOSED))?.value,
    onSuccess: (authorizeUrl) => { if (authorizeUrl !== undefined) window.location.assign(authorizeUrl) },
    onError: () => { void queryClient.invalidateQueries({ queryKey: efacturaQueryKeys.connection }) },
  })
  const disconnect = useMutation({
    mutationFn: async () => (await sessionWrite(auth, (token) => efactura.disconnect(token), SESSION_CLOSED))?.value,
    onSuccess: (connection) => { if (connection !== undefined) queryClient.setQueryData(efacturaQueryKeys.connection, connection) },
  })
  // Not held after success: a page restored from the back-forward cache after ANAF must still connect.
  const pending = connect.isPending || disconnect.isPending

  if (!enabled) return undefined
  return {
    view: read.data === undefined ? undefined : connectionView(read.data),
    isPending: read.isPending,
    error: read.data === undefined ? efacturaFailure(read.error) : undefined,
    retry: retryAction(read.error, () => { void read.refetch() }),
    failure: efacturaFailure(connect.error ?? disconnect.error),
    notice,
    pending,
    connect: () => {
      if (pending) return
      setNotice(undefined)
      disconnect.reset()
      connect.mutate()
    },
    disconnect: () => {
      if (pending || !window.confirm(DISCONNECT_CONFIRM)) return
      setNotice(undefined)
      connect.reset()
      disconnect.mutate()
    },
  }
}
