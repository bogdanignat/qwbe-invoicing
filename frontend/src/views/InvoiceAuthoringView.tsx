import { AppLink } from "../components/ui/AppLink.tsx"
import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { InvoiceAuthoringSession } from "../components/authoring/InvoiceAuthoringSession.tsx"
import { LockedDraftReadonly } from "../components/authoring/LockedDraftReadonly.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useInvoiceAuthoringPage } from "../hooks/use-invoice-authoring-page.ts"

interface InvoiceAuthoringViewProps {
  /** The draft to edit, or nothing for a new document. */
  readonly id?: string
}

/**
 * The authoring screen's frame: session, then prerequisites, then the form.
 *
 * Each missing prerequisite is its own state with its own explanation: what the
 * user sets up links to Setări; the VAT and unit catalogues come from the
 * server, so those say so instead.
 */
export const InvoiceAuthoringView = ({ id }: InvoiceAuthoringViewProps) => {
  const shell = useAuthenticatedShell()
  const page = useInvoiceAuthoringPage(id)
  return <PrivateScreen shell={shell}>
    <Page
      title={page.kind === "ready" && page.initialDraft !== undefined ? `Draft ${page.initialDraft.series}` : "Factură nouă"}
      eyebrow="Document de lucru"
      actions={<AppLink className="button secondary" href="/invoices">Înapoi la documente</AppLink>}
    >
      {page.kind === "loading" ? <Loading label="Se pregătește formularul…" />
        : page.kind === "error" ? <ErrorAlert error={page.error} onRetry={page.retry} />
        : page.kind === "issuer-required" ? <p className="setup-note">Datele firmei emitente nu sunt completate. Completează-le în <AppLink href="/settings">Setări</AppLink>, împreună cu o serie pentru facturi, apoi revino aici.</p>
        : page.kind === "vat-catalogue-empty" ? <p className="setup-note">Catalogul de regimuri TVA nu a venit de la server; nu se completează din aplicație. Reîncarcă pagina, iar dacă problema rămâne, verifică instalarea serverului.</p>
        : page.kind === "invoice-series-required" ? <p className="setup-note">Nu există nicio serie activă pentru facturi. Adaug-o sau reactiveaz-o în <AppLink href="/settings">Setări</AppLink>, apoi revino aici.</p>
        : page.kind === "unit-catalogue-empty" ? <p className="setup-note">Catalogul de unități de măsură a venit gol de la server; nu se completează din aplicație. Reîncarcă pagina, iar dacă problema rămâne, verifică instalarea serverului.</p>
        : page.kind === "draft-missing" ? <p className="setup-note">Draftul cerut nu există sau nu mai este disponibil. <AppLink href="/invoices">Întoarce-te la registrul de facturi</AppLink>.</p>
        : page.kind === "locked" ? <LockedDraftReadonly
          title={page.title} notice={page.notice}
          registryHref={page.registryHref} registryLabel={page.registryLabel}
        />
        : <InvoiceAuthoringSession
          key={page.sessionKey}
          initialDraft={page.initialDraft}
          issuer={page.issuer}
          vatCatalogue={page.vatCatalogue}
          customers={page.customers}
          customersHasMore={page.customersHasMore}
          customersLoadingMore={page.customersLoadingMore}
          customersLoadMore={page.customersLoadMore}
          invoiceSeries={page.invoiceSeries}
          unitOfMeasures={page.unitOfMeasures}
          productPresets={page.productPresets}
          presetsHasMore={page.presetsHasMore}
          presetsLoadingMore={page.presetsLoadingMore}
          presetsLoadMore={page.presetsLoadMore}
          backgroundErrors={page.backgroundErrors}
        />}
    </Page>
  </PrivateScreen>
}
