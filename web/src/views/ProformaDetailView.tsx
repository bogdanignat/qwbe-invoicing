import { ErrorAlert, Loading } from "../components/layout/AsyncState.tsx"
import { CommercialDocument } from "../components/document/CommercialDocument.tsx"
import { Page } from "../components/layout/Page.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { useProformaDetail } from "../hooks/proforma-hooks.ts"

export const ProformaDetailView = ({ id }: { readonly id: string }) => {
  const state = useProformaDetail(id)
  if (state.proforma.data === undefined && state.proforma.isPending) return <Loading />
  if (state.proforma.data === undefined) return <Page title="Proformă" eyebrow="Document comercial"><ErrorAlert error={state.proforma.error} /></Page>
  const proforma = state.proforma.data
  return <Page title="Proformă" eyebrow="Document comercial" actions={<Button variant="secondary" onClick={() => { state.download.start() }} disabled={state.download.pending}>{state.download.pending ? "Se generează…" : "Descarcă PDF"}</Button>}>
    {state.proforma.error === null ? null : <ErrorAlert error={state.proforma.error} />}
    {state.download.error === null ? null : <ErrorAlert error={state.download.error} />}
    {state.conversion.error === null ? null : <ErrorAlert error={state.conversion.error} />}
    <CommercialDocument snapshot={proforma} identity={{ kind: "proforma", series: proforma.series, number: proforma.number }} lineCaption="Linii proformă" />
    <section className="card overview-section">
      <div className="section-heading"><div><h2>Emitere factură</h2><p>Factura preia exact datele și totalurile acestei proforme și primește propriul număr fiscal.</p></div></div>
      {state.conversion.converted.kind === "invoice"
        ? <><p><span className="badge positive">Facturată</span></p><ButtonLink variant="secondary" href={state.conversion.converted.href}>Deschide factura emisă</ButtonLink></>
        : state.conversion.converted.kind === "draft"
          ? <><p><span className="badge info">Draft factură creat</span></p><ButtonLink variant="secondary" href={state.conversion.converted.href}>Deschide draftul creat anterior</ButtonLink></>
          : <><label>Serie factură<select value={state.conversion.selectedSeries} disabled={state.conversion.pending || state.conversion.series.length === 0} onChange={(event) => { state.conversion.selectSeries(event.currentTarget.value) }}><option value="" disabled>Alege seria facturii</option>{state.conversion.series.map((series) => <option key={series} value={series}>{series}</option>)}</select></label>
            {state.conversion.series.length === 0 ? <p className="status-note warning">Configurează o serie de factură în <a href="/settings">setări</a>.</p> : null}
            {state.conversion.dueDateIssue === null ? null : <p className="status-note warning">{state.conversion.dueDateIssue}</p>}
            <div className="button-row"><Button disabled={!state.conversion.canIssueInvoice} onClick={state.conversion.issueInvoice}>{state.conversion.pending ? "Operație în curs…" : "Emite factura"}</Button><Button variant="secondary" disabled={!state.conversion.canCreateDraft} onClick={state.conversion.createDraft}>Creează draft de factură</Button></div></>}
    </section>
  </Page>
}
