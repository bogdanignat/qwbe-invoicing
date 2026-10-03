"use client"

import { Button } from "../Button.tsx"
import { CustomerAddressFields } from "./CustomerAddressFields.tsx"
import { ErrorAlert } from "../AsyncState.tsx"
import { Field } from "../ui/Field.tsx"
import { FieldIssue } from "./FieldIssue.tsx"
import { Input } from "../ui/Input.tsx"
import { identifierLabel } from "../../lib/document-authoring-transitions.ts"
import { useEditorHeadingFocus } from "../../hooks/use-editor-heading-focus.ts"
import { useRefusedFieldFocus } from "../../hooks/use-refused-field-focus.ts"
import { CUSTOMER_FORM, registryFieldAria } from "../../lib/registry-fields.ts"
import { identifierMaxLength, type CustomerField } from "../../lib/customer-payload.ts"
import { romanianCuiPattern } from "../../lib/vat-defaults.ts"
import type { CustomerForm } from "../../lib/customer-form.ts"
import type { PartyType } from "../../lib/document-authoring-form-model.ts"
import type { RegistryEditorIssue } from "../../hooks/use-registry-editor.ts"

interface CustomerEditorSectionProps {
  readonly form: CustomerForm
  /** The customer being edited; absent while a new one is created. */
  readonly editingId: string | undefined
  readonly sectorRequired: boolean
  readonly issue: RegistryEditorIssue<CustomerField> | undefined
  readonly pending: boolean
  readonly error: unknown
  readonly onChange: (patch: Partial<CustomerForm>) => void
  readonly onPartyTypeChange: (partyType: PartyType) => void
  readonly onIdentifierChange: (value: string) => void
  readonly onCountyChange: (county: string) => void
  readonly onSubmit: () => void
  readonly onClose: () => void
}

/** The customer editor: the party, its fiscal identifier, its address and the payment term. */
export const CustomerEditorSection = (props: CustomerEditorSectionProps) => {
  const { editingId, form, issue, pending } = props
  const headingRef = useEditorHeadingFocus(editingId ?? "new")
  useRefusedFieldFocus(CUSTOMER_FORM, issue?.field)
  const aria = registryFieldAria(CUSTOMER_FORM, issue?.field)
  const company = form.partyType === "company"
  return <section className="card">
    <div className="section-heading"><div>
      <h2 ref={headingRef} tabIndex={-1}>{editingId === undefined ? "Client nou" : "Editezi clientul"}</h2>
      <p>Datele sunt copiate pe document în momentul emiterii.</p>
    </div></div>
    {props.error === null || props.error === undefined ? null : <ErrorAlert error={props.error} />}
    <form className="authoring-section" onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>
      <div className="form-grid">
        <fieldset className="segmented-fieldset span-two"><legend>Tip persoană</legend><div className="segmented-control">
          <label><input type="radio" name="customerPartyType" value="company" checked={company} disabled={pending}
            onChange={() => { props.onPartyTypeChange("company") }} /><span>Persoană juridică (PJ)</span></label>
          <label><input type="radio" name="customerPartyType" value="individual" checked={!company} disabled={pending}
            onChange={() => { props.onPartyTypeChange("individual") }} /><span>Persoană fizică (PF)</span></label>
        </div></fieldset>
        <Field label={company ? "Denumire" : "Nume complet"} required>
          <Input required disabled={pending} value={form.name} {...aria("name")}
            onChange={(event) => { props.onChange({ name: event.currentTarget.value }) }} />
          <FieldIssue issue={issue} field="name" form={CUSTOMER_FORM} />
        </Field>
        <Field label={identifierLabel(form.partyType)} optional={!company} required={company}>
          <Input value={form.fiscalIdentifier} required={company} disabled={pending}
            maxLength={identifierMaxLength(form.partyType)} {...aria("fiscalIdentifier")}
            pattern={company ? romanianCuiPattern : "(?:[0-9]{13})?"}
            inputMode={company ? "text" : "numeric"}
            title={company ? "CUI românesc numeric; prefixul RO introdus este eliminat" : "CNP valid din 13 cifre sau câmp gol"}
            onChange={(event) => { props.onIdentifierChange(event.currentTarget.value) }} />
          <FieldIssue issue={issue} field="fiscalIdentifier" form={CUSTOMER_FORM} />
        </Field>
        {company
          ? <label className="checkbox-label"><input type="checkbox" checked={form.vatRegistered} disabled={pending}
            onChange={(event) => { props.onChange({ vatRegistered: event.currentTarget.checked }) }} /> Client înregistrat în scopuri de TVA</label>
          : null}
        <CustomerAddressFields form={form} disabled={pending} sectorRequired={props.sectorRequired}
          issue={issue} aria={aria} onChange={props.onChange} onCountyChange={props.onCountyChange} />
        <Field label="Termen de plată (zile)" optional>
          <Input disabled={pending} value={form.defaultPaymentTermDays} inputMode="numeric" pattern="[0-9]*"
            {...aria("defaultPaymentTermDays")}
            title="Număr întreg de zile, între 0 și 3650"
            onChange={(event) => { props.onChange({ defaultPaymentTermDays: event.currentTarget.value }) }} />
          <FieldIssue issue={issue} field="defaultPaymentTermDays" form={CUSTOMER_FORM} />
        </Field>
      </div>
      <div className="button-row">
        <Button type="submit" disabled={pending}>{pending ? "Se salvează…" : "Salvează clientul"}</Button>
        <Button className="secondary" disabled={pending} onClick={props.onClose}>Renunță</Button>
      </div>
    </form>
  </section>
}
