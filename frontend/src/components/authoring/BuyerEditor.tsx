"use client"

import { Button } from "../Button.tsx"
import { Field } from "../ui/Field.tsx"
import { Select } from "../ui/Select.tsx"
import { BuyerOneTimeFields } from "./BuyerOneTimeFields.tsx"
import { identifierLabel } from "../../lib/invoice-authoring-transitions.ts"
import type { SavedBuyer } from "../../hooks/invoice-authoring-session-types.ts"
import type { BuyerMode, InvoiceAuthoringForm, PartyType } from "../../lib/invoice-authoring-model.ts"
import type { Customer } from "../../lib/draft-models.ts"

interface BuyerEditorProps {
  readonly form: InvoiceAuthoringForm
  readonly customers: ReadonlyArray<Customer>
  /** The saved customer the draft was written for, even when the paged registry has not reached it yet. */
  readonly savedBuyer: SavedBuyer | undefined
  readonly customersHasMore: boolean
  readonly customersLoadingMore: boolean
  readonly onCustomersLoadMore: () => void
  readonly disabled: boolean
  readonly sectorRequired: boolean
  readonly onChange: (patch: Partial<InvoiceAuthoringForm>) => void
  readonly onBuyerModeChange: (buyerMode: BuyerMode) => void
  readonly onSavedCustomerChange: (customerId: string) => void
  readonly onPartyTypeChange: (partyType: PartyType) => void
  readonly onCountyChange: (county: string) => void
  readonly onFiscalIdentifierChange: (value: string) => void
  readonly onSectorChange: (sector: string) => void
}

/** The buyer half of the authoring form: a saved customer or a one-time party, never a registry write. */
export const BuyerEditor = (props: BuyerEditorProps) => {
  const { form, customers, savedBuyer } = props
  // The paged registry may never include the draft's own buyer (the registry
  // is larger than a page), so the draft's snapshot stands in as an explicit
  // option instead of an invisible value.
  const registryMissesBuyer = form.buyerMode === "saved" && savedBuyer !== undefined
    && form.customerId === savedBuyer.customerId
    && !customers.some((customer) => customer.id === form.customerId)
  const savedModeUsable = customers.length > 0 || registryMissesBuyer
  return <section className="card authoring-section">
    <div className="section-heading"><div><h2>Cumpărător</h2><p>Alege un client salvat sau completează un client folosit doar pe acest document.</p></div></div>
    <fieldset className="segmented-fieldset"><legend>Sursa cumpărătorului</legend><div className="segmented-control">
      <label><input type="radio" name="buyerMode" value="saved" checked={form.buyerMode === "saved"} disabled={props.disabled || !savedModeUsable} onChange={() => { props.onBuyerModeChange("saved") }} /><span>Client salvat</span></label>
      <label><input type="radio" name="buyerMode" value="one-time" checked={form.buyerMode === "one-time"} disabled={props.disabled} onChange={() => { props.onBuyerModeChange("one-time") }} /><span>Client ocazional</span></label>
    </div></fieldset>
    {form.buyerMode === "saved" ? <div className="authoring-section">
      {!savedModeUsable
        ? <p className="status-note">Registrul este gol. Alege „Client ocazional” și continuă fără să salvezi clientul în registru.</p>
        : <Field label="Client" required>
          <Select required disabled={props.disabled} value={form.customerId} onChange={(event) => { props.onSavedCustomerChange(event.currentTarget.value) }}>
            <option value="" disabled>Alege clientul</option>
            {registryMissesBuyer
              ? <option value={savedBuyer.customerId}>
                {savedBuyer.customer.name}{savedBuyer.customer.fiscalIdentifier === "" ? "" : ` — ${identifierLabel(savedBuyer.customer.partyType)} ${savedBuyer.customer.fiscalIdentifier}`} (clientul din acest draft)
              </option>
              : null}
            {customers.map((customer) => <option key={customer.id} value={customer.id}>
              {customer.name}{customer.fiscalIdentifier === "" ? "" : ` — ${identifierLabel(customer.partyType)} ${customer.fiscalIdentifier}`}
            </option>)}
          </Select>
        </Field>}
      {props.customersHasMore
        ? <p><Button className="secondary small" disabled={props.customersLoadingMore} onClick={props.onCustomersLoadMore}>
          {props.customersLoadingMore ? "Se încarcă…" : "Încarcă mai mulți clienți"}
        </Button></p>
        : null}
      <p className="hint">Datele clientului ocazional rămân păstrate dacă schimbi temporar modul.</p>
    </div> : <BuyerOneTimeFields
      form={form} disabled={props.disabled} sectorRequired={props.sectorRequired}
      onChange={props.onChange} onPartyTypeChange={props.onPartyTypeChange}
      onCountyChange={props.onCountyChange} onFiscalIdentifierChange={props.onFiscalIdentifierChange}
      onSectorChange={props.onSectorChange}
    />}
  </section>
}
