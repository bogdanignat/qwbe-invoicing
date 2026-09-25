"use client"

import { DocumentSeriesCard } from "../components/settings/DocumentSeriesCard.tsx"
import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { IssuerSettingsCard } from "../components/settings/IssuerSettingsCard.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { SettingsHelpDialog } from "../components/settings/SettingsHelpDialog.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useDocumentSeries } from "../hooks/use-document-series.ts"
import { useIssuerSettings } from "../hooks/use-issuer-settings.ts"

/**
 * The configuration screen: the issuer profile, its VAT regime and the document
 * series, with the field guide one button away.
 *
 * The series card loads on its own rather than behind the issuer's read: a
 * profile that has not been saved yet is exactly the moment someone needs to see
 * which series exist, and one slow read must not hide the other panel.
 */
export const SettingsView = () => {
  const shell = useAuthenticatedShell()
  const issuer = useIssuerSettings()
  const series = useDocumentSeries()
  const { load } = issuer
  return <PrivateScreen shell={shell}>
    <Page title="Date firmă" eyebrow="Configurare emitent" actions={<SettingsHelpDialog />}>
      {shell.error === undefined ? null : <ErrorAlert error={shell.error} />}
      {load.kind === "loading" ? <Loading label="Se încarcă datele firmei…" /> : null}
      {load.kind === "error" ? <ErrorAlert error={load.error} onRetry={issuer.retry} /> : null}
      {load.kind === "ready" ? <IssuerSettingsCard model={issuer} /> : null}
      <DocumentSeriesCard model={series} />
    </Page>
  </PrivateScreen>
}
