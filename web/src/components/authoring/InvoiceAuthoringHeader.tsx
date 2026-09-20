import type { InvoiceAuthoringSessionViewModel } from "../../hooks/invoice-authoring-session-hooks.ts"
import { DocumentHeader } from "../document/DocumentHeader.tsx"
import { SellerSummary } from "../document/SellerSummary.tsx"
import { BuyerEditor } from "./BuyerEditor.tsx"

export const InvoiceAuthoringHeader = ({ state }: { readonly state: InvoiceAuthoringSessionViewModel }) => {
  const { actions, document, feedback, status } = state
  return <div className="card authoring-header"><DocumentHeader
    identity={<section className="document-identity">
      <h2>{document.draft === undefined ? "DOCUMENT NOU" : "DRAFT"}</h2>
      <p className="hint">Numărul se alocă la emitere.</p>
      <div className="document-date-fields">
        <label>Serie factură<select required disabled={status.pending || document.draft !== undefined} value={document.form.series} onChange={(event) => { actions.changeForm({ series: event.currentTarget.value }) }}>{document.invoiceSeries.map((series) => <option key={series} value={series}>{series}</option>)}</select></label>
        <label>Data emiterii<input required disabled={status.pending} type="date" value={document.form.issueDate} onChange={(event) => { actions.chooseIssueDate(event.currentTarget.value) }} /></label>
        <label>Data scadenței {status.dueDateRequired ? <span className="required">obligatorie la emitere</span> : <span className="optional">opțională în draft</span>}<input disabled={status.pending} type="date" min={document.form.issueDate} value={document.form.dueDate} aria-required={status.dueDateRequired} aria-describedby={feedback.dueDateIssue === null ? undefined : "invoice-due-date-issue"} onChange={(event) => { actions.chooseDueDate(event.currentTarget.value) }} /></label>
        <div className="static-field"><span>Monedă</span><span className="fixed-value">RON</span></div>
      </div>
    </section>}
    issuer={<SellerSummary issuer={document.issuer} />}
    customer={<BuyerEditor form={document.form} customers={document.customers} disabled={status.pending} sectorRequired={document.buyerSectorRequired} onChange={actions.changeForm} onBuyerModeChange={actions.chooseBuyerMode} onSavedCustomerChange={actions.chooseCustomer} onPartyTypeChange={actions.choosePartyType} onCountyChange={actions.chooseCounty} onFiscalIdentifierChange={actions.changeFiscalIdentifier} onSectorChange={actions.chooseSector} />}
  /></div>
}
