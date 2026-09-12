import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { InvoiceAuthoringSession } from "../components/InvoiceAuthoringSession.tsx"
import { Page } from "../components/Page.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { useInvoiceAuthoringPage } from "../invoice-authoring-page-hooks.ts"

interface InvoiceAuthoringViewProps {
  readonly id?: string
  readonly notify: (message: string) => void
}

export const InvoiceAuthoringView = ({ id, notify }: InvoiceAuthoringViewProps) => {
  const state = useInvoiceAuthoringPage(id)
  if (state.kind === "loading") return <Loading />
  if (state.kind === "error") return <Page title="Editare factură" eyebrow="Document de lucru"><ErrorAlert error={state.error} /></Page>
  if (state.kind === "locked") return <Page title={state.title} eyebrow="Document blocat" actions={<ButtonLink variant="ghost" href={state.registryHref}>Înapoi la registru</ButtonLink>}>
    <section className="card empty" role="status"><strong>Draft blocat</strong><p>{state.notice}</p><ButtonLink href={state.registryHref}>{state.registryLabel}</ButtonLink></section>
  </Page>
  if (state.kind === "issuer-required") return <Page title="Factură nouă" eyebrow="Configurare necesară"><section className="card empty"><strong>Configurează mai întâi furnizorul.</strong><ButtonLink href="/settings">Deschide setările</ButtonLink></section></Page>
  if (state.kind === "vat-catalogue-empty") return <Page title="Factură nouă" eyebrow="Catalog indisponibil"><EmptyState>Catalogul TVA nu a putut fi încărcat.</EmptyState></Page>
  if (state.kind === "invoice-series-required") return <Page title="Factură nouă" eyebrow="Configurare necesară"><section className="card empty"><strong>Configurează o serie de factură.</strong><ButtonLink href="/settings">Deschide setările</ButtonLink></section></Page>
  if (state.kind === "unit-catalogue-empty") return <Page title="Factură nouă" eyebrow="Catalog indisponibil"><EmptyState>Catalogul unităților de măsură este gol.</EmptyState></Page>
  if (state.kind === "draft-missing") return <Page title="Draft indisponibil" eyebrow="Document de lucru"><EmptyState>Draftul nu a putut fi încărcat.</EmptyState></Page>
  return <InvoiceAuthoringSession key={state.sessionKey} {...state} notify={notify} />
}
