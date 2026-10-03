"use client"

import Link from "next/link"

import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { ProformaAuthoringSession } from "../components/authoring/ProformaAuthoringSession.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useProformaAuthoringPage } from "../hooks/use-proforma-authoring-page.ts"

/**
 * The proforma authoring frame: prerequisites first, then the form.
 *
 * A missing proforma series is deliberately not one of these states — it is a
 * note beside a closed save inside the form, so the document can still be filled
 * while the series is added. What blocks here is what the form cannot be built
 * from at all: the issuer, the VAT catalogue and the units.
 */
export const ProformaAuthoringView = () => {
  const shell = useAuthenticatedShell()
  const page = useProformaAuthoringPage()
  return <PrivateScreen shell={shell}>
    <Page
      title="Proformă nouă"
      eyebrow="Document comercial"
      actions={<Link className="button secondary" href="/proformas">Înapoi la proforme</Link>}
    >
      {page.kind === "loading" ? <Loading label="Se pregătește formularul…" />
        : page.kind === "error" ? <ErrorAlert error={page.error} onRetry={page.retry} />
        : page.kind === "issuer-required" ? <p className="setup-note">Nu există încă un profil de emitent. Configurează firma emitentă (datele firmei și seriile de documente) în aplicația existentă, apoi revino aici.</p>
        : page.kind === "vat-catalogue-empty" ? <p className="setup-note">Catalogul de regimuri TVA nu este disponibil. Verifică configurarea TVA a organizației în aplicația existentă, apoi reîncearcă.</p>
        : page.kind === "unit-catalogue-empty" ? <p className="setup-note">Catalogul de unități de măsură este gol. Verifică configurarea organizației în aplicația existentă, apoi reîncearcă.</p>
        : <ProformaAuthoringSession {...page.session} />}
    </Page>
  </PrivateScreen>
}
