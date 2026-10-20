import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { CompanyLookupCard } from "../components/integrations/CompanyLookupCard.tsx"
import { EFacturaCard } from "../components/integrations/EFacturaCard.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { AppLink } from "../components/ui/AppLink.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useCompanyLookupSettings } from "../hooks/use-company-lookup-settings.ts"
import { useEFacturaConnection } from "../hooks/use-efactura-connection.ts"

/**
 * Integrări: company lookup and ANAF e-Factura, each only with its
 * plugin on. With both off the screen says so and asks nothing, since the
 * routes would answer `404`.
 */
export const IntegrationsView = () => {
  const shell = useAuthenticatedShell()
  const model = useCompanyLookupSettings()
  const eFactura = useEFacturaConnection()
  const { load } = model
  return <PrivateScreen shell={shell}>
    <Page title="Integrări" eyebrow="Configurare">
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      {load.kind === "off" && eFactura === undefined
        ? <p className="status-note">Această instalare nu are integrări pornite. <AppLink href="/settings">Înapoi la datele firmei</AppLink></p>
        : null}
      <div className="grid gap-6">
        {eFactura === undefined ? null : <EFacturaCard model={eFactura} />}
        {load.kind === "loading" ? <Loading label="Se încarcă integrările…" /> : null}
        {load.kind === "denied" ? <p className="status-note warning" role="alert">{load.message}</p> : null}
        {load.kind === "error" ? <ErrorAlert error={new Error(load.message)} onRetry={model.retry} /> : null}
        {load.kind === "ready" ? <CompanyLookupCard model={model} settings={load.settings} /> : null}
      </div>
    </Page>
  </PrivateScreen>
}
