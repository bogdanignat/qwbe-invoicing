import type { InvoiceAuthoringSession } from "../../hooks/invoice-authoring-session-types.ts"
import { BuyerEditor } from "./BuyerEditor.tsx"
import { Field } from "../ui/Field.tsx"
import { Input } from "../ui/Input.tsx"
import { Select } from "../ui/Select.tsx"

/**
 * The document head: identity, series, dates and currency, next to the issuer
 * the invoice will be signed by. The series stays a choice while the draft is
 * open; a series archived since the draft was saved is still listed, marked,
 * until another one is chosen.
 */
export const InvoiceAuthoringHeader = ({ session }: { readonly session: InvoiceAuthoringSession }) => {
  const { actions, document, feedback, status } = session
  return <div className="card authoring-section">
    <div className="section-heading"><div>
      <h2>{document.draft === undefined ? "Document nou" : `Draft ${document.draft.series}`}</h2>
      <p>Numărul se alocă la emitere. Totalurile sunt calculate de server la fiecare salvare.</p>
    </div></div>
    <div className="document-date-fields">
      <Field label="Serie factură" required>
        <Select required disabled={status.pending} value={document.form.series}
          aria-describedby={feedback.seriesWarning === undefined ? undefined : "invoice-series-warning"}
          onChange={(event) => { actions.changeForm({ series: event.currentTarget.value }) }}>
          {document.seriesChoices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </Select>
      </Field>
      <Field label="Data emiterii" required>
        <Input required disabled={status.pending} type="date" value={document.form.issueDate}
          onChange={(event) => { actions.chooseIssueDate(event.currentTarget.value) }} />
      </Field>
      <Field label="Data scadenței" required={status.dueDateRequired} optional={!status.dueDateRequired}>
        <Input disabled={status.pending} type="date" min={document.form.issueDate} value={document.form.dueDate}
          aria-required={status.dueDateRequired}
          aria-describedby={feedback.dueDateIssue === null ? undefined : "invoice-due-date-issue"}
          onChange={(event) => { actions.chooseDueDate(event.currentTarget.value) }} />
      </Field>
      <div className="static-field"><span>Monedă</span><span className="fixed-value">RON</span></div>
    </div>
    <BuyerEditor
      form={document.form} customers={document.customers} savedBuyer={document.savedBuyer}
      customersHasMore={document.customersHasMore} customersLoadingMore={document.customersLoadingMore}
      onCustomersLoadMore={document.customersLoadMore}
      disabled={status.pending} sectorRequired={document.buyerSectorRequired}
      onChange={actions.changeForm} onBuyerModeChange={actions.chooseBuyerMode}
      onSavedCustomerChange={actions.chooseCustomer} onPartyTypeChange={actions.choosePartyType}
      onCountyChange={actions.chooseCounty} onFiscalIdentifierChange={actions.changeFiscalIdentifier}
      onSectorChange={actions.chooseSector}
    />
  </div>
}
