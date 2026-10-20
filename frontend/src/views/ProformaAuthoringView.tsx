import { AppLink } from "../components/ui/AppLink.tsx"
import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { ProformaAuthoringSession } from "../components/authoring/ProformaAuthoringSession.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useProformaAuthoringPage } from "../hooks/use-proforma-authoring-page.ts"

/**
 * The proforma authoring frame: prerequisites first, then the form.
 *
 * Like the invoice screen, every missing prerequisite (the issuer, the VAT
 * catalogue, the proforma series, the units) is said before the form, so the
 * link to Setări never leaves a filled-in form behind.
 */
export const ProformaAuthoringView = () => {
  const shell = useAuthenticatedShell()
  const page = useProformaAuthoringPage()
  return <PrivateScreen shell={shell}>
    <Page
      title="Proformă nouă"
      eyebrow="Document comercial"
      actions={<AppLink className="button secondary" href="/proformas">Înapoi la proforme</AppLink>}
    >
      {page.kind === "loading" ? <Loading label="Se pregătește formularul…" />
        : page.kind === "error" ? <ErrorAlert error={page.error} onRetry={page.retry} />
        : page.kind === "issuer-required" ? <p className="setup-note">Datele firmei emitente nu sunt completate. Completează-le în <AppLink href="/settings">Setări</AppLink>, împreună cu o serie pentru proforme, apoi revino aici.</p>
        : page.kind === "vat-catalogue-empty" ? <p className="setup-note">Catalogul de regimuri TVA nu a venit de la server; nu se completează din aplicație. Reîncarcă pagina, iar dacă problema rămâne, verifică instalarea serverului.</p>
        : page.kind === "proforma-series-required" ? <p className="setup-note">Nu există nicio serie pentru proforme. Adaug-o în <AppLink href="/settings">Setări</AppLink>, apoi revino aici.</p>
        : page.kind === "unit-catalogue-empty" ? <p className="setup-note">Catalogul de unități de măsură a venit gol de la server; nu se completează din aplicație. Reîncarcă pagina, iar dacă problema rămâne, verifică instalarea serverului.</p>
        : <ProformaAuthoringSession {...page.session} />}
    </Page>
  </PrivateScreen>
}
