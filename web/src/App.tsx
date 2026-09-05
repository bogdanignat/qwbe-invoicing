import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { Effect } from "effect"

import { loginApiSession, logoutApiSession, onUnauthorized, restoreApiSession, runUiEffect } from "./api.ts"
import { Loading } from "./components/AsyncState.tsx"
import { Page } from "./components/Page.tsx"
import { Shell } from "./components/Shell.tsx"
import { ButtonLink } from "./components/ui/ButtonLink.tsx"
import { invoicingClient } from "./invoicing-client.ts"
import { currentRoute, navigate, subscribeToRoute } from "./navigation.ts"
import { matchUiRoute } from "../../standalone/ui-routes.ts"
import { CustomersView } from "./views/CustomersView.tsx"
import { DraftView } from "./views/DraftView.tsx"
import { InvoiceDetailView } from "./views/InvoiceDetailView.tsx"
import { InvoicesView } from "./views/InvoicesView.tsx"
import { NewInvoiceView } from "./views/NewInvoiceView.tsx"
import { ProformaDetailView } from "./views/ProformaDetailView.tsx"
import { ProformasView } from "./views/ProformasView.tsx"
import { ProductPresetsView } from "./views/ProductPresetsView.tsx"
import { SettingsView } from "./views/SettingsView.tsx"
import { UnlockView } from "./views/UnlockView.tsx"

export const App = () => {
  const route = useSyncExternalStore(subscribeToRoute, currentRoute)
  const queryClient = useQueryClient()
  const [authState, setAuthState] = useState<"checking" | "locked" | "unlocked">("checking")
  const [logoutPending, setLogoutPending] = useState(false)
  const [toast, setToast] = useState<string | undefined>(undefined)
  const toastTimer = useRef<number | undefined>(undefined)
  useEffect(() => onUnauthorized(() => {
    queryClient.clear()
    setAuthState("locked")
    navigate("/unlock", { replace: true })
  }), [queryClient])
  useEffect(() => {
    const controller = new AbortController()
    void runUiEffect(restoreApiSession, controller.signal).then(() => {
      if (controller.signal.aborted) return
      queryClient.clear()
      setAuthState("unlocked")
      if (currentRoute() === "/unlock") navigate("/invoices", { replace: true })
    }).catch(() => {
      if (controller.signal.aborted) return
      queryClient.clear()
      setAuthState("locked")
      navigate("/unlock", { replace: true })
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
    navigate("/invoices", { replace: true })
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
      navigate("/unlock", { replace: true })
    }
  }

  let content: ReactNode
  const unlocked = authState === "unlocked"
  if (authState === "checking") {
    content = <Loading label="Verific sesiunea…" />
  } else if (!unlocked) {
    content = <UnlockView onUnlock={unlock} />
  } else {
    const matched = matchUiRoute(route)
    switch (matched.kind) {
      case "invoices": content = <InvoicesView />; break
      case "invoice-new": content = <NewInvoiceView notify={notify} />; break
      case "proformas": content = <ProformasView />; break
      case "customers": content = <CustomersView notify={notify} />; break
      case "products": content = <ProductPresetsView notify={notify} />; break
      case "settings": content = <SettingsView notify={notify} />; break
      case "draft": content = <DraftView id={matched.id} notify={notify} />; break
      case "invoice": content = <InvoiceDetailView id={matched.id} notify={notify} />; break
      case "proforma": content = <ProformaDetailView id={matched.id} />; break
      case "unlock": content = <InvoicesView />; break
      case "not-found": content = <Page title="Pagina nu există" eyebrow="404"><p>Ruta cerută nu este disponibilă.</p><ButtonLink href="/invoices">Înapoi la facturi</ButtonLink></Page>; break
    }
  }

  return <><Shell unlocked={unlocked} route={route} logoutPending={logoutPending} onLogout={logout}>{content}</Shell>{toast === undefined ? null : <div className="toast" role="status">{toast}</div>}</>
}
