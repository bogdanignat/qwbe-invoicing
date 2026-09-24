"use client"

import Link from "next/link"

import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { PrivateScreen } from "../components/PrivateScreen.tsx"
import { InvoiceAuthoringSession } from "../components/authoring/InvoiceAuthoringSession.tsx"
import { useAuthenticatedShell } from "../hooks/use-authenticated-shell.ts"
import { useInvoiceAuthoringPage } from "../hooks/use-invoice-authoring-page.ts"

interface InvoiceAuthoringViewProps {
  /** The draft to edit, or nothing for a new document. */
  readonly id?: string
}

/**
 * The authoring screen's frame: session, then prerequisites, then the form.
 *
 * Each missing prerequisite is its own state with its own explanation, naming
 * where the setup has to happen — this frontend has no settings, catalog or
 * master-data screens yet, so pointing at one would be pointing at nothing.
 */
export const InvoiceAuthoringView = ({ id }: InvoiceAuthoringViewProps) => {
  const shell = useAuthenticatedShell()
  const page = useInvoiceAuthoringPage(id)
  return <PrivateScreen shell={shell}>
    <Page
      title={page.kind === "ready" && page.initialDraft !== undefined ? `Draft ${page.initialDraft.series}` : "Factură nouă"}
      eyebrow="Document de lucru"
      actions={<Link className="button secondary" href="/invoices">Înapoi la documente</Link>}
    >
      {page.kind === "loading" ? <Loading label="Se pregătește formularul…" />
        : page.kind === "error" ? <ErrorAlert error={page.error} onRetry={page.retry} />
        : page.kind === "issuer-required" ? <p className="setup-note">Nu există încă un profil de emitent. Configurează firma emitentă (datele firmei și seria de facturi) în aplicația existentă, apoi revino aici.</p>
        : page.kind === "vat-catalogue-empty" ? <p className="setup-note">Catalogul de regimuri TVA nu este disponibil. Verifică configurarea TVA a organizației în aplicația existentă, apoi reîncearcă.</p>
        : page.kind === "invoice-series-required" ? <p className="setup-note">Nu există nicio serie de facturi configurată. Adaugă o serie pentru facturi în aplicația existentă, apoi revino aici.</p>
        : page.kind === "unit-catalogue-empty" ? <p className="setup-note">Catalogul de unități de măsură este gol. Verifică configurarea organizației în aplicația existentă, apoi reîncearcă.</p>
        : page.kind === "draft-missing" ? <p className="setup-note">Draftul cerut nu există sau nu mai este disponibil. <Link href="/invoices">Întoarce-te la registrul de facturi</Link>.</p>
        : page.kind === "locked" ? <div className="card">
          <h2>{page.title}</h2>
          <p>{page.notice}</p>
          <p><Link className="button secondary" href={page.registryHref}>{page.registryLabel}</Link></p>
        </div>
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
