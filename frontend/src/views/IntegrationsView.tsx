import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { CompanyLookupCard } from "../components/settings/integrations/CompanyLookupCard.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { SettingsSectionsNav } from "../components/settings/SettingsSectionsNav.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useCompanyLookupSettings } from "../hooks/use-company-lookup-settings.ts"

/**
 * Setări → Integrări. It exists only with the company-lookup plugin on; with it
 * off the screen says so and asks nothing, since the routes would answer `404`.
 */
export const IntegrationsView = () => {
  const shell = useAuthenticatedShell()
  const model = useCompanyLookupSettings()
  const { load } = model
  return <PrivateScreen shell={shell}>
    <Page title="Integrări" eyebrow="Setări">
      <SettingsSectionsNav current="integrations" />
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      {load.kind === "off"
        ? <p className="status-note">Această instalare nu are integrări pornite. <a href="/settings">Înapoi la datele firmei</a></p>
        : null}
      {load.kind === "loading" ? <Loading label="Se încarcă integrările…" /> : null}
      {load.kind === "denied" ? <p className="status-note warning" role="alert">{load.message}</p> : null}
      {load.kind === "error" ? <ErrorAlert error={new Error(load.message)} onRetry={model.retry} /> : null}
      {load.kind === "ready" ? <CompanyLookupCard model={model} settings={load.settings} /> : null}
    </Page>
  </PrivateScreen>
}
