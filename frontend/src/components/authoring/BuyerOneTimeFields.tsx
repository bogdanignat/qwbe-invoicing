"use client"

import type { InvoiceAuthoringForm, PartyType } from "../../lib/invoice-authoring-model.ts"
import { Field } from "../ui/Field.tsx"
import { Input } from "../ui/Input.tsx"
import { Select } from "../ui/Select.tsx"
import { identifierLabel } from "../../lib/document-authoring-transitions.ts"
import { ROMANIAN_COUNTIES } from "../../lib/romanian-counties.ts"
import { romanianCuiPattern } from "../../lib/vat-defaults.ts"

interface BuyerOneTimeFieldsProps {
  readonly form: InvoiceAuthoringForm
  readonly disabled: boolean
  readonly sectorRequired: boolean
  readonly onChange: (patch: Partial<InvoiceAuthoringForm>) => void
  readonly onPartyTypeChange: (partyType: PartyType) => void
  readonly onCountyChange: (county: string) => void
  readonly onFiscalIdentifierChange: (value: string) => void
  readonly onSectorChange: (sector: string) => void
}

/** The one-time (ad-hoc) buyer: a party typed on this document and never written to a registry. */
export const BuyerOneTimeFields = (props: BuyerOneTimeFieldsProps) => {
  const { form, disabled, sectorRequired } = props
  const fiscalIdentifier = form.partyType === "company" ? form.companyTaxIdentifier : form.individualTaxIdentifier
  return <div className="form-grid">
    <fieldset className="segmented-fieldset span-two"><legend>Tip persoană</legend><div className="segmented-control">
      <label><input type="radio" name="partyType" value="company" checked={form.partyType === "company"} disabled={disabled} onChange={() => { props.onPartyTypeChange("company") }} /><span>Persoană juridică (PJ)</span></label>
      <label><input type="radio" name="partyType" value="individual" checked={form.partyType === "individual"} disabled={disabled} onChange={() => { props.onPartyTypeChange("individual") }} /><span>Persoană fizică (PF)</span></label>
    </div></fieldset>
    <Field label={form.partyType === "company" ? "Denumire" : "Nume complet"} required>
      <Input required disabled={disabled} value={form.name} onChange={(event) => { props.onChange({ name: event.currentTarget.value }) }} />
    </Field>
    <Field label={identifierLabel(form.partyType)} optional={form.partyType === "individual"} required={form.partyType === "company"}>
      <Input value={fiscalIdentifier} required={form.partyType === "company"} disabled={disabled}
        pattern={form.partyType === "company" ? romanianCuiPattern : "(?:[0-9]{13})?"} maxLength={13}
        title={form.partyType === "company" ? "CUI românesc numeric; prefixul RO introdus este eliminat" : "CNP valid din 13 cifre sau câmp gol"}
        inputMode={form.partyType === "individual" ? "numeric" : "text"}
        onChange={(event) => { props.onFiscalIdentifierChange(event.currentTarget.value) }} />
    </Field>
    {form.partyType === "company"
      ? <label className="checkbox-label"><input type="checkbox" checked={form.vatRegistered} disabled={disabled} onChange={(event) => { props.onChange({ vatRegistered: event.currentTarget.checked }) }} /> Cumpărător înregistrat în scopuri de TVA</label>
      : null}
    <Field label="Țară"><Select value="RO" disabled><option value="RO">România (RO)</option></Select></Field>
    <Field label="Localitate" required>
      <Input required disabled={disabled} value={form.city} onChange={(event) => { props.onChange({ city: event.currentTarget.value }) }} />
    </Field>
    <Field label="Stradă și număr" required className="span-two">
      <Input required disabled={disabled} value={form.street} onChange={(event) => { props.onChange({ street: event.currentTarget.value }) }} />
    </Field>
    <Field label="Județ" required>
      <Select required disabled={disabled} value={form.county} onChange={(event) => { props.onCountyChange(event.currentTarget.value) }}>
        <option value="" disabled>Alege județul</option>
        {ROMANIAN_COUNTIES.map((county) => <option key={county.code} value={county.code}>{county.name}</option>)}
      </Select>
    </Field>
    {sectorRequired
      ? <Field label="Sector" required>
        <Select required disabled={disabled} value={form.sector ?? ""} onChange={(event) => { props.onSectorChange(event.currentTarget.value) }}>
          <option value="" disabled>Alege sectorul</option>
          {[1, 2, 3, 4, 5, 6].map((sector) => <option key={sector} value={sector}>Sector {sector}</option>)}
        </Select>
      </Field>
      : null}
    <Field label="Cod poștal" optional>
      <Input disabled={disabled} value={form.postalCode} onChange={(event) => { props.onChange({ postalCode: event.currentTarget.value }) }} />
    </Field>
  </div>
}
