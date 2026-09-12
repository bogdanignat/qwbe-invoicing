import { BuyerEditor } from "./BuyerEditor.tsx"
import { ErrorAlert } from "./AsyncState.tsx"
import { InvoiceLinesEditor } from "./InvoiceLinesEditor.tsx"
import { InvoiceTotals } from "./InvoiceTotals.tsx"
import { Page } from "./Page.tsx"
import { ProformaIssueControl } from "./ProformaIssueControl.tsx"
import { SellerSummary } from "./SellerSummary.tsx"
import { Button } from "./ui/Button.tsx"
import { ButtonLink } from "./ui/ButtonLink.tsx"
import { useInvoiceAuthoringSession, type InvoiceAuthoringSessionInput } from "../invoice-authoring-session-hooks.ts"

export const InvoiceAuthoringSession = (props: InvoiceAuthoringSessionInput) => {
  const state = useInvoiceAuthoringSession(props)
  const { actions, document, feedback, status } = state
  return <Page title={document.draft === undefined ? "Document nou" : `Draft ${document.draft.series}`} eyebrow="Document de lucru" actions={<ButtonLink variant="ghost" href="/invoices">Înapoi la documente</ButtonLink>}>
    {feedback.backgroundErrors.map((error, index) => <ErrorAlert key={`${error.message}-${String(index)}`} error={error} />)}
    {feedback.mutationError === null ? null : <ErrorAlert error={feedback.mutationError} />}
    {feedback.resumableSave ? <p className="status-note warning" role="status">Draftul a fost creat și păstrat în această pagină. Corectează eroarea și apasă din nou „Salvează draftul”; vor fi retrimise numai liniile rămase sau modificate.</p> : null}
    {feedback.issuerWarning === undefined ? null : <p className="status-note warning" role="status">{feedback.issuerWarning} Salvarea draftului rămâne disponibilă; API-ul verifică emiterea.</p>}
    {feedback.staleTaxWarning === null ? null : <p className="status-note warning" role="status" aria-live="polite">{feedback.staleTaxWarning}</p>}
    <form className="authoring-form" onSubmit={(event) => { event.preventDefault(); actions.save() }}>
      <div className="authoring-main">
        <SellerSummary issuer={document.issuer} />
        <BuyerEditor form={document.form} customers={document.customers} disabled={status.pending} onChange={actions.changeForm} onBuyerModeChange={actions.chooseBuyerMode} onSavedCustomerChange={actions.chooseCustomer} />
        <section className="card authoring-section">
          <div className="section-heading"><div><h2>3. Date document</h2><p>Alege seria facturii; poți salva un draft sau emite direct. Moneda este RON.</p></div></div>
          <div className="form-grid four">
            <label>Serie factură<select required disabled={status.pending || document.draft !== undefined} value={document.form.series} onChange={(event) => { actions.changeForm({ series: event.currentTarget.value }) }}>{document.invoiceSeries.map((series) => <option key={series} value={series}>{series}</option>)}</select></label>
            <label>Data emiterii<input required disabled={status.pending} type="date" value={document.form.issueDate} onChange={(event) => { actions.chooseIssueDate(event.currentTarget.value) }} /></label>
            <label>Data scadenței <span className="optional">opțională</span><input disabled={status.pending} type="date" min={document.form.issueDate} value={document.form.dueDate} onChange={(event) => { actions.chooseDueDate(event.currentTarget.value) }} /></label>
            <div className="static-field"><span>Monedă</span><span className="fixed-value">RON</span></div>
          </div>
          <label className="notes-field">Observații <span className="optional">opțional</span><textarea disabled={status.pending} maxLength={feedback.notesMaxLength} rows={3} aria-describedby="notes-status" aria-invalid={feedback.notesIssue !== null} value={document.form.notes} onChange={(event) => { actions.changeForm({ notes: event.currentTarget.value }) }} /></label>
          <p className={feedback.notesIssue === null ? "hint notes-status" : "hint notes-status warning"} id="notes-status" aria-live="polite">{feedback.notesIssue ?? `${String(document.form.notes.length)}/${String(feedback.notesMaxLength)}`}</p>
        </section>
        <InvoiceLinesEditor lines={document.lines} productPresets={document.productPresets} vatRates={document.vatRates} unitOfMeasures={document.unitOfMeasures} pending={status.pending} onAdd={actions.addLine} onChange={actions.changeLine} onApplyPreset={actions.choosePreset} onDelete={actions.deleteLine} />
      </div>
      <div className="authoring-side">
        <InvoiceTotals draft={document.draft} />
        <section className="card draft-actions">
          <h2>Acțiuni document</h2>
          <Button variant="secondary" fullWidth type="submit" disabled={status.pending}>{status.savePending ? "Se salvează toate modificările…" : "Salvează draftul"}</Button>
          <p className="hint">Draftul este opțional și rămâne editabil.</p>
          <ProformaIssueControl state={state.proformaIssuance} />
          <h3>Emitere factură</h3>
          <Button fullWidth disabled={!status.canIssueInvoice} onClick={(event) => { if (event.currentTarget.form?.reportValidity() !== false) actions.issueInvoice() }}>{status.invoicePending ? "Se emite…" : "Emite factura"}</Button>
          {document.draft === undefined ? null : <Button variant="danger" fullWidth disabled={status.pending} onClick={actions.deleteDraft}>Șterge draftul</Button>}
          <p className="hint">Dintr-un document nou poți emite direct. Dacă ai salvat deja draftul, salvează întâi orice modificare nouă.</p>
        </section>
      </div>
    </form>
  </Page>
}
