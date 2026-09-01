import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { Effect } from "effect"

import { loginApiSession, logoutApiSession, onUnauthorized, restoreApiSession, runUiEffect } from "./api.ts"
import { Loading } from "./components/AsyncState.tsx"
import { Page } from "./components/Page.tsx"
import { Shell } from "./components/Shell.tsx"
import { invoicingClient } from "./invoicing-client.ts"
import { CustomersView } from "./views/CustomersView.tsx"
import { DraftView } from "./views/DraftView.tsx"
import { InvoiceDetailView } from "./views/InvoiceDetailView.tsx"
import { InvoicesView } from "./views/InvoicesView.tsx"
import { NewInvoiceView } from "./views/NewInvoiceView.tsx"
import { SettingsView } from "./views/SettingsView.tsx"
import { UnlockView } from "./views/UnlockView.tsx"

const subscribeToHash = (callback: () => void): (() => void) => {
  window.addEventListener("hashchange", callback)
  return () => { window.removeEventListener("hashchange", callback) }
}
const currentHash = (): string => window.location.hash.slice(1) || "/unlock"

export const App = () => {
  const route = useSyncExternalStore(subscribeToHash, currentHash)
  const queryClient = useQueryClient()
  const [authState, setAuthState] = useState<"checking" | "locked" | "unlocked">("checking")
  const [logoutPending, setLogoutPending] = useState(false)
  const [toast, setToast] = useState<string | undefined>(undefined)
  const toastTimer = useRef<number | undefined>(undefined)
  useEffect(() => onUnauthorized(() => {
    queryClient.clear()
    setAuthState("locked")
    window.location.hash = "#/unlock"
  }), [queryClient])
  useEffect(() => {
    const controller = new AbortController()
    void runUiEffect(restoreApiSession, controller.signal).then(() => {
      if (controller.signal.aborted) return
      queryClient.clear()
      setAuthState("unlocked")
      if (currentHash() === "/unlock") window.location.hash = "#/invoices"
    }).catch(() => {
      if (controller.signal.aborted) return
      queryClient.clear()
      setAuthState("locked")
      window.location.hash = "#/unlock"
    })
    return () => { controller.abort() }
  }, [queryClient])
  const notify = (message: string): void => {
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => { setToast(undefined) }, 3200)
  }
  const unlock = async (token: string): Promise<void> => {
    await runUiEffect(Effect.zipRight(loginApiSession(token), invoicingClient.listCustomers()))
    queryClient.clear()
    setAuthState("unlocked")
    window.location.hash = "#/invoices"
  }
  const logout = async (): Promise<void> => {
    if (logoutPending) return
    setLogoutPending(true)
    try {
      await runUiEffect(logoutApiSession)
    } catch (error) {
      notify(error instanceof Error ? `${error.message} Sesiunea locală a fost închisă.` : "Sesiunea locală a fost închisă, dar serverul nu a confirmat ieșirea.")
    } finally {
      queryClient.clear()
      setAuthState("locked")
      setLogoutPending(false)
      window.location.hash = "#/unlock"
    }
  }

  let content: ReactNode
  const unlocked = authState === "unlocked"
  if (authState === "checking") {
    content = <Loading label="Verific sesiunea…" />
  } else if (!unlocked) {
    content = <UnlockView onUnlock={unlock} />
  } else if (route === "/invoices") {
    content = <InvoicesView />
  } else if (route === "/invoices/new") {
    content = <NewInvoiceView />
  } else if (route === "/customers") {
    content = <CustomersView notify={notify} />
  } else if (route === "/settings") {
    content = <SettingsView notify={notify} />
  } else {
    const draft = /^\/drafts\/([^/]+)$/.exec(route)
    const invoice = /^\/invoices\/([^/]+)$/.exec(route)
    if (draft?.[1] !== undefined) content = <DraftView id={decodeURIComponent(draft[1])} notify={notify} />
    else if (invoice?.[1] !== undefined) content = <InvoiceDetailView id={decodeURIComponent(invoice[1])} notify={notify} />
    else content = <Page title="Pagina nu există" eyebrow="404"><p>Ruta cerută nu este disponibilă.</p><a className="button primary" href="#/invoices">Înapoi la facturi</a></Page>
  }

  return <><Shell unlocked={unlocked} route={route} logoutPending={logoutPending} onLogout={logout}>{content}</Shell>{toast === undefined ? null : <div className="toast" role="status">{toast}</div>}</>
}
