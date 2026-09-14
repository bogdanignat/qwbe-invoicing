import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { ProformaAuthoringSession } from "../components/ProformaAuthoringSession.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { useProformaAuthoringPage } from "../proforma-authoring-hooks.ts"

export const ProformaAuthoringView = () => {
  const state = useProformaAuthoringPage()
  if (state.kind === "loading") return <Loading />
  if (state.kind === "error") return <Page title="Proformă nouă" eyebrow="Document comercial"><ErrorAlert error={state.error} /></Page>
  if (state.kind === "issuer-required") return <Page title="Proformă nouă" eyebrow="Configurare necesară"><section className="card empty"><strong>Configurează mai întâi furnizorul.</strong><ButtonLink href="/settings">Deschide setările</ButtonLink></section></Page>
  if (state.kind === "vat-catalogue-empty") return <Page title="Proformă nouă" eyebrow="Catalog indisponibil"><EmptyState>Catalogul TVA nu a putut fi încărcat.</EmptyState></Page>
  if (state.kind === "unit-catalogue-empty") return <Page title="Proformă nouă" eyebrow="Catalog indisponibil"><EmptyState>Catalogul unităților de măsură este gol.</EmptyState></Page>
  return <ProformaAuthoringSession {...state} />
}
