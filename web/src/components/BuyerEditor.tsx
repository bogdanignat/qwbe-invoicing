import type { BuyerMode, InvoiceAuthoringForm } from "../invoice-authoring-state.ts"
import { identifierLabel, switchPartyType } from "../invoice-authoring-state.ts"
import type { Customer, PartyType } from "../models.ts"
import { normalizeRomanianCui, romanianCuiPattern } from "../vat-defaults.ts"

interface BuyerEditorProps {
  readonly form: InvoiceAuthoringForm
  readonly customers: ReadonlyArray<Customer>
  readonly disabled: boolean
  readonly onChange: (patch: Partial<InvoiceAuthoringForm>) => void
  readonly onBuyerModeChange: (buyerMode: BuyerMode) => void
  readonly onSavedCustomerChange: (customerId: string) => void
}

export const BuyerEditor = ({ form, customers, disabled, onChange, onBuyerModeChange, onSavedCustomerChange }: BuyerEditorProps) => {
  const choosePartyType = (partyType: PartyType): void => { onChange(switchPartyType(form, partyType)) }
  const fiscalIdentifier = form.partyType === "company" ? form.companyTaxIdentifier : form.individualTaxIdentifier
  return <section className="card authoring-section">
    <div className="section-heading"><div><h2>2. Cumpărător</h2><p>Alege un client salvat sau completează un client folosit doar pe această factură.</p></div></div>
    <fieldset className="segmented-fieldset"><legend>Sursa cumpărătorului</legend><div className="segmented-control">
      <label><input type="radio" name="buyerMode" value="saved" checked={form.buyerMode === "saved"} disabled={disabled || customers.length === 0} onChange={() => { onBuyerModeChange("saved") }} /><span>Client salvat</span></label>
      <label><input type="radio" name="buyerMode" value="one-time" checked={form.buyerMode === "one-time"} disabled={disabled} onChange={() => { onBuyerModeChange("one-time") }} /><span>Client ocazional</span></label>
    </div></fieldset>
    {form.buyerMode === "saved" ? <div>
      {customers.length === 0 ? <p className="status-note">Registrul este gol. Alege „Client ocazional” și continuă fără să salvezi clientul în registru.</p> : <label>Client<select required disabled={disabled} value={form.customerId} onChange={(event) => { onSavedCustomerChange(event.currentTarget.value) }}><option value="" disabled>Alege clientul</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.fiscalIdentifier === "" ? "" : ` — ${identifierLabel(customer.partyType)} ${customer.fiscalIdentifier}`}</option>)}</select></label>}
      <p className="hint left">Datele clientului ocazional rămân păstrate dacă schimbi temporar modul.</p>
    </div> : <>
      <fieldset className="segmented-fieldset"><legend>Tip persoană</legend><div className="segmented-control compact-segments">
        <label><input type="radio" name="partyType" value="company" checked={form.partyType === "company"} disabled={disabled} onChange={() => { choosePartyType("company") }} /><span>Persoană juridică (PJ)</span></label>
        <label><input type="radio" name="partyType" value="individual" checked={form.partyType === "individual"} disabled={disabled} onChange={() => { choosePartyType("individual") }} /><span>Persoană fizică (PF)</span></label>
      </div></fieldset>
      <div className="form-grid two">
        <label>{form.partyType === "company" ? "Denumire" : "Nume complet"}<input required disabled={disabled} value={form.name} onChange={(event) => { onChange({ name: event.currentTarget.value }) }} /></label>
        <label>{identifierLabel(form.partyType)} {form.partyType === "individual" ? <span className="optional">opțional</span> : null}<input value={fiscalIdentifier} required={form.partyType === "company"} disabled={disabled} pattern={form.partyType === "company" ? romanianCuiPattern : "(?:[0-9]{13})?"} maxLength={13} title={form.partyType === "company" ? "CUI românesc valid, cu sau fără prefixul RO" : "CNP valid din 13 cifre sau câmp gol"} inputMode={form.partyType === "individual" ? "numeric" : "text"} onChange={(event) => { const value = form.partyType === "company" ? normalizeRomanianCui(event.currentTarget.value) : event.currentTarget.value.replace(/\D/g, ""); onChange(form.partyType === "company" ? { companyTaxIdentifier: value } : { individualTaxIdentifier: value }) }} /></label>
        <label>Țară<select value="RO" disabled><option value="RO">România (RO)</option></select></label>
        <label>Localitate<input required disabled={disabled} value={form.city} onChange={(event) => { onChange({ city: event.currentTarget.value }) }} /></label>
        <label className="span-two">Stradă și număr<input required disabled={disabled} value={form.street} onChange={(event) => { onChange({ street: event.currentTarget.value }) }} /></label>
        <label>Județ <span className="optional">opțional</span><input disabled={disabled} value={form.county} onChange={(event) => { onChange({ county: event.currentTarget.value }) }} /></label>
        <label>Cod poștal <span className="optional">opțional</span><input disabled={disabled} value={form.postalCode} onChange={(event) => { onChange({ postalCode: event.currentTarget.value }) }} /></label>
      </div>
    </>}
  </section>
}
