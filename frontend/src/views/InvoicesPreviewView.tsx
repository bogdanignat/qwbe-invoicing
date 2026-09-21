"use client"

import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { Shell } from "../components/Shell.tsx"
import { SessionRecovery } from "../components/SessionRecovery.tsx"
import { useInvoicesPreviewModel } from "../hooks/use-invoices-preview-model.ts"

export const InvoicesPreviewView = () => {
  const model = useInvoicesPreviewModel()
  if (model.status === "restore-error") {
    return <Shell unlocked={false}><SessionRecovery error={model.error} onRetry={model.retryRestore} /></Shell>
  }
  if (model.status !== "authenticated") return <Shell unlocked={false}><Loading label="Verific sesiunea…" /></Shell>
  return <Shell unlocked logoutPending={model.logoutPending} onLogout={model.logout}>
    <Page title="Previzualizare frontend Next" eyebrow="Facturi">
      {model.error === undefined ? null : <ErrorAlert error={model.error} />}
      <section className="card preview-card">
        <span className="status-dot" aria-hidden="true" /><h2>Sesiune autentificată</h2>
        <p>Conexiunea prin sesiunea opacă este activă.</p>
        <p><strong>Lista de facturi nu este migrată în această etapă.</strong> Folosește interfața existentă pentru operațiunile de facturare.</p>
      </section>
    </Page>
  </Shell>
}
