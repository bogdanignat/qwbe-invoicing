import type { BuyerMode, InvoiceAuthoringForm } from "../invoice-authoring-state.ts"
import { identifierLabel } from "../invoice-authoring-state.ts"
import type { Customer, PartyType } from "../models.ts"
import { ROMANIAN_COUNTIES } from "../romanian-counties.ts"
import { romanianCuiPattern } from "../vat-defaults.ts"

interface BuyerEditorProps {
  readonly form: InvoiceAuthoringForm
  readonly customers: ReadonlyArray<Customer>
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

export const BuyerEditor = ({ form, customers, disabled, sectorRequired, onChange, onBuyerModeChange, onSavedCustomerChange, onPartyTypeChange, onCountyChange, onFiscalIdentifierChange, onSectorChange }: BuyerEditorProps) => {
  const fiscalIdentifier = form.partyType === "company" ? form.companyTaxIdentifier : form.individualTaxIdentifier
  return <section className="card authoring-section">
    <div className="section-heading"><div><h2>Cumpărător</h2><p>Alege un client salvat sau completează un client folosit doar pe acest document.</p></div></div>
    <fieldset className="segmented-fieldset"><legend>Sursa cumpărătorului</legend><div className="segmented-control">
      <label><input type="radio" name="buyerMode" value="saved" checked={form.buyerMode === "saved"} disabled={disabled || customers.length === 0} onChange={() => { onBuyerModeChange("saved") }} /><span>Client salvat</span></label>
      <label><input type="radio" name="buyerMode" value="one-time" checked={form.buyerMode === "one-time"} disabled={disabled} onChange={() => { onBuyerModeChange("one-time") }} /><span>Client ocazional</span></label>
    </div></fieldset>
    {form.buyerMode === "saved" ? <div>
      {customers.length === 0 ? <p className="status-note">Registrul este gol. Alege „Client ocazional” și continuă fără să salvezi clientul în registru.</p> : <label>Client<select required disabled={disabled} value={form.customerId} onChange={(event) => { onSavedCustomerChange(event.currentTarget.value) }}><option value="" disabled>Alege clientul</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.fiscalIdentifier === "" ? "" : ` — ${identifierLabel(customer.partyType)} ${customer.fiscalIdentifier}`}</option>)}</select></label>}
      <p className="hint left">Datele clientului ocazional rămân păstrate dacă schimbi temporar modul.</p>
    </div> : <>
      <fieldset className="segmented-fieldset"><legend>Tip persoană</legend><div className="segmented-control compact-segments">
        <label><input type="radio" name="partyType" value="company" checked={form.partyType === "company"} disabled={disabled} onChange={() => { onPartyTypeChange("company") }} /><span>Persoană juridică (PJ)</span></label>
        <label><input type="radio" name="partyType" value="individual" checked={form.partyType === "individual"} disabled={disabled} onChange={() => { onPartyTypeChange("individual") }} /><span>Persoană fizică (PF)</span></label>
      </div></fieldset>
      <div className="form-grid two">
        <label>{form.partyType === "company" ? "Denumire" : "Nume complet"}<input required disabled={disabled} value={form.name} onChange={(event) => { onChange({ name: event.currentTarget.value }) }} /></label>
        <label>{identifierLabel(form.partyType)} {form.partyType === "individual" ? <span className="optional">opțional</span> : null}<input value={fiscalIdentifier} required={form.partyType === "company"} disabled={disabled} pattern={form.partyType === "company" ? romanianCuiPattern : "(?:[0-9]{13})?"} maxLength={13} title={form.partyType === "company" ? "CUI românesc numeric; prefixul RO introdus este eliminat" : "CNP valid din 13 cifre sau câmp gol"} inputMode={form.partyType === "individual" ? "numeric" : "text"} onChange={(event) => { onFiscalIdentifierChange(event.currentTarget.value) }} /></label>
        {form.partyType === "company" ? <label className="checkbox-label"><input type="checkbox" checked={form.vatRegistered} disabled={disabled} onChange={(event) => { onChange({ vatRegistered: event.currentTarget.checked }) }} /> Cumpărător înregistrat în scopuri de TVA</label> : null}
        <label>Țară<select value="RO" disabled><option value="RO">România (RO)</option></select></label>
        <label>Localitate<input required disabled={disabled} value={form.city} onChange={(event) => { onChange({ city: event.currentTarget.value }) }} /></label>
        <label className="span-two document-address-field">Stradă și număr<input required disabled={disabled} value={form.street} onChange={(event) => { onChange({ street: event.currentTarget.value }) }} /></label>
        <label>Județ<select required disabled={disabled} value={form.county} onChange={(event) => { onCountyChange(event.currentTarget.value) }}><option value="" disabled>Alege județul</option>{ROMANIAN_COUNTIES.map((county) => <option key={county.code} value={county.code}>{county.name}</option>)}</select></label>
        {sectorRequired ? <label>Sector<select required disabled={disabled} value={form.sector ?? ""} onChange={(event) => { onSectorChange(event.currentTarget.value) }}><option value="" disabled>Alege sectorul</option>{[1, 2, 3, 4, 5, 6].map((sector) => <option key={sector} value={sector}>Sector {sector}</option>)}</select></label> : null}
        <label>Cod poștal <span className="optional">opțional</span><input disabled={disabled} value={form.postalCode} onChange={(event) => { onChange({ postalCode: event.currentTarget.value }) }} /></label>
      </div>
    </>}
  </section>
}
