import { BuyerEditor } from "./BuyerEditor.tsx"
import { ErrorAlert } from "../layout/AsyncState.tsx"
import { DocumentHeader } from "../document/DocumentHeader.tsx"
import { InvoiceLinesEditor } from "./InvoiceLinesEditor.tsx"
import { InvoiceTotals } from "../document/InvoiceTotals.tsx"
import { Page } from "../layout/Page.tsx"
import { SellerSummary } from "../document/SellerSummary.tsx"
import { Button } from "../ui/Button.tsx"
import { ButtonLink } from "../ui/ButtonLink.tsx"
import { useProformaAuthoringSession, type ProformaAuthoringSessionInput } from "../../hooks/proforma-authoring-hooks.ts"

export const ProformaAuthoringSession = (props: ProformaAuthoringSessionInput) => {
  const { actions, document, feedback, status } = useProformaAuthoringSession(props)
  return <Page title="Proformă nouă" eyebrow="Document comercial" actions={<ButtonLink variant="ghost" href="/proformas">Înapoi la proforme</ButtonLink>}>
    {feedback.backgroundErrors.map((error, index) => <ErrorAlert key={`${error.message}-${String(index)}`} error={error} />)}
    {feedback.mutationError === null ? null : <ErrorAlert error={feedback.mutationError} />}
    {feedback.issuerWarning === undefined ? null : <p className="status-note warning" role="status">{feedback.issuerWarning}</p>}
    <form className="authoring-form" onSubmit={(event) => { event.preventDefault(); actions.save() }}>
      <div className="card authoring-header">
        <DocumentHeader
          identity={<section className="document-identity"><h2>PROFORMĂ NOUĂ</h2><p className="hint">Numărul se alocă la salvare.</p><div className="document-date-fields">
            <label>Serie proformă<select required disabled={status.pending} value={document.form.series} onChange={(event) => { actions.changeForm({ series: event.currentTarget.value }) }}><option value="" disabled>Alege seria</option>{document.proformaSeries.map((series) => <option key={series} value={series}>{series}</option>)}</select></label>
            <label>Data emiterii<input required disabled={status.pending} type="date" value={document.form.issueDate} onChange={(event) => { actions.chooseIssueDate(event.currentTarget.value) }} /></label>
            <label>Data scadenței <span className="optional">opțională</span><input disabled={status.pending} type="date" min={document.form.issueDate} value={document.form.dueDate} onChange={(event) => { actions.chooseDueDate(event.currentTarget.value) }} /></label>
            <div className="static-field"><span>Monedă</span><span className="fixed-value">RON</span></div>
          </div></section>}
          issuer={<SellerSummary issuer={document.issuer} />}
          customer={<BuyerEditor form={document.form} customers={document.customers} disabled={status.pending} sectorRequired={document.buyerSectorRequired} onChange={actions.changeForm} onBuyerModeChange={actions.chooseBuyerMode} onSavedCustomerChange={actions.chooseCustomer} onPartyTypeChange={actions.choosePartyType} onCountyChange={actions.chooseCounty} onFiscalIdentifierChange={actions.changeFiscalIdentifier} onSectorChange={actions.chooseSector} />}
        />
      </div>
      <div className="authoring-main"><div className="card authoring-section">
        <label className="notes-field">Observații <span className="optional">opțional</span><textarea disabled={status.pending} maxLength={feedback.notesMaxLength} rows={3} aria-describedby="proforma-notes-status" aria-invalid={feedback.notesIssue !== null} value={document.form.notes} onChange={(event) => { actions.changeForm({ notes: event.currentTarget.value }) }} /></label>
        <p className={feedback.notesIssue === null ? "hint notes-status" : "hint notes-status warning"} id="proforma-notes-status" aria-live="polite">{feedback.notesIssue ?? `${String(document.form.notes.length)}/${String(feedback.notesMaxLength)}`}</p>
      </div><InvoiceLinesEditor lines={document.lines} productPresets={document.productPresets} vatRates={document.vatRates} unitOfMeasures={document.unitOfMeasures} pending={status.pending} onAdd={actions.addLine} onChange={actions.changeLine} onApplyPreset={actions.choosePreset} onDelete={actions.deleteLine} /></div>
      <div className="authoring-side"><InvoiceTotals draft={undefined} emptyMessage="Totalurile vor fi calculate la salvarea proformei." /><section className="card draft-actions"><h2>Acțiuni proformă</h2>
        {status.seriesMissing ? <p className="status-note warning">Configurează o serie de proformă în <a href="/settings">setări</a>.</p> : null}
        <Button fullWidth type="submit" disabled={!status.canSave}>{status.pending ? "Se salvează…" : "Salvează proforma"}</Button>
      </section></div>
    </form>
  </Page>
}
