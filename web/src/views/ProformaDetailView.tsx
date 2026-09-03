import { ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { CommercialDocument } from "../components/CommercialDocument.tsx"
import { Page } from "../components/Page.tsx"
import { useProformaDetail } from "../proforma-hooks.ts"

export const ProformaDetailView = ({ id }: { readonly id: string }) => {
  const state = useProformaDetail(id)
  if (state.proforma.data === undefined && state.proforma.isPending) return <Loading />
  if (state.proforma.data === undefined) return <Page title="Proformă" eyebrow="Document comercial"><ErrorAlert error={state.proforma.error} /></Page>
  const proforma = state.proforma.data
  return <Page title={`Proformă ${proforma.series} ${String(proforma.number)}`} eyebrow={`Emisă la ${proforma.issueDate}`} actions={<button className="button secondary" type="button" onClick={() => { state.download.start() }} disabled={state.download.pending}>{state.download.pending ? "Se generează…" : "Descarcă PDF"}</button>}>
    {state.proforma.error === null ? null : <ErrorAlert error={state.proforma.error} />}
    {state.download.error === null ? null : <ErrorAlert error={state.download.error} />}
    {state.issuance.error === null ? null : <ErrorAlert error={state.issuance.error} />}
    <CommercialDocument snapshot={proforma} heading={`PROFORMĂ ${proforma.series} ${String(proforma.number)}`} notice="DOCUMENT NEFISCAL" lineCaption="Linii proformă" />
    <section className="card overview-section">
      <div className="section-heading"><div><h2>Emitere factură</h2><p>Factura preia exact datele și totalurile acestei proforme și primește propriul număr fiscal.</p></div></div>
      {proforma.convertedInvoiceId !== null
        ? <a className="button secondary" href={`/invoices/${encodeURIComponent(proforma.convertedInvoiceId)}`}>Deschide factura emisă</a>
        : proforma.convertedDraftId !== null
          ? <a className="button secondary" href={`/drafts/${encodeURIComponent(proforma.convertedDraftId)}`}>Deschide draftul creat anterior</a>
          : <button className="button primary" type="button" disabled={state.issuance.pending} onClick={state.issuance.issueInvoice}>{state.issuance.pending ? "Se emite…" : "Emite factura"}</button>}
    </section>
  </Page>
}
