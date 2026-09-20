import { ErrorAlert, Loading } from "../components/layout/AsyncState.tsx"
import { DocumentSeriesCard } from "../components/settings/DocumentSeriesCard.tsx"
import { IssuerBrandingFields } from "../components/settings/IssuerBrandingFields.tsx"
import { IssuerIdentityFields } from "../components/settings/IssuerIdentityFields.tsx"
import { IssuerVatFields } from "../components/settings/IssuerVatFields.tsx"
import { Page } from "../components/layout/Page.tsx"
import { SettingsHelpDialog } from "../components/settings/SettingsHelpDialog.tsx"
import { Button } from "../components/ui/Button.tsx"
import { useIssuerSettings } from "../hooks/issuer-settings-hooks.ts"

export const SettingsView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const state = useIssuerSettings(notify)
  if (state.issuerQuery.isPending || state.catalogueQuery.isPending) return <Loading />
  if (state.issuerQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={state.issuerQuery.error} /></Page>
  if (state.catalogueQuery.error !== null) return <Page title="Date firmă" eyebrow="Configurare emitent"><ErrorAlert error={state.catalogueQuery.error} /></Page>
  return <Page title="Date firmă" eyebrow="Configurare emitent">
    <div className="settings-help-row"><SettingsHelpDialog /></div>
    <section className="card form-card">
      {state.save.error === null ? null : <ErrorAlert error={state.save.error} />}
      <form key={state.formKey} onSubmit={state.submit}>
        <fieldset className="issuer-settings-fields" disabled={state.save.pending}>
          <IssuerIdentityFields state={state} />
          <hr />
          <IssuerBrandingFields state={state} />
          <hr />
          <IssuerVatFields state={state} />
          {state.branding.imageError === null ? null : <p className="status-note warning" id="issuer-brand-save-warning">Sigla selectată nu este validă. Alege alt fișier sau renunță la fișierul respins înainte de salvare.</p>}
          <div className="form-actions"><Button type="submit" aria-describedby={state.branding.imageError === null ? undefined : "issuer-brand-save-warning"} disabled={state.save.pending || state.branding.pending}>{state.save.pending ? "Se salvează…" : "Salvează datele firmei"}</Button></div>
        </fieldset>
      </form>
    </section>
    <DocumentSeriesCard notify={notify} />
  </Page>
}
