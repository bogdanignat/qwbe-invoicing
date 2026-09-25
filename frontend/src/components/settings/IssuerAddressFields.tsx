"use client"

import { Field } from "../ui/Field.tsx"
import { FieldIssue } from "../registry/FieldIssue.tsx"
import { Input } from "../ui/Input.tsx"
import { Select } from "../ui/Select.tsx"
import { ROMANIAN_COUNTIES } from "../../lib/romanian-counties.ts"
import { ISSUER_FORM, type RegistryFieldAria } from "../../lib/registry-fields.ts"
import type { IssuerField } from "../../lib/issuer-payload.ts"
import type { IssuerSettingsForm } from "../../lib/issuer-form.ts"
import type { RegistryEditorIssue } from "../../hooks/use-registry-editor.ts"

interface IssuerAddressFieldsProps {
  readonly form: IssuerSettingsForm
  readonly disabled: boolean
  readonly sectorRequired: boolean
  readonly issue: RegistryEditorIssue<IssuerField> | undefined
  readonly aria: (field: IssuerField) => RegistryFieldAria
  readonly onChange: (patch: Partial<IssuerSettingsForm>) => void
  readonly onCountyChange: (county: string) => void
}

/**
 * The fiscal address printed on every document: Romania only, with the sector
 * shown exactly where one exists — the model drops it when the county changes,
 * so this never renders a field the payload would not carry.
 */
export const IssuerAddressFields = (props: IssuerAddressFieldsProps) => {
  const { form, disabled, issue, aria } = props
  return <div className="form-grid">
    <Field label="Țară"><Select value="RO" disabled><option value="RO">România (RO)</option></Select></Field>
    <Field label="Localitate" required>
      <Input required disabled={disabled} value={form.city} {...aria("city")}
        onChange={(event) => { props.onChange({ city: event.currentTarget.value }) }} />
      <FieldIssue issue={issue} field="city" form={ISSUER_FORM} />
    </Field>
    <Field label="Stradă și număr" required className="span-two">
      <Input required disabled={disabled} value={form.street} {...aria("street")}
        onChange={(event) => { props.onChange({ street: event.currentTarget.value }) }} />
      <FieldIssue issue={issue} field="street" form={ISSUER_FORM} />
    </Field>
    <Field label="Județ" required>
      <Select required disabled={disabled} value={form.county} {...aria("county")}
        onChange={(event) => { props.onCountyChange(event.currentTarget.value) }}>
        <option value="" disabled>Alege județul</option>
        {ROMANIAN_COUNTIES.map((county) => <option key={county.code} value={county.code}>{county.name}</option>)}
      </Select>
      <FieldIssue issue={issue} field="county" form={ISSUER_FORM} />
    </Field>
    {props.sectorRequired
      ? <Field label="Sector" required>
        <Select required disabled={disabled} value={form.sector} {...aria("sector")}
          onChange={(event) => { props.onChange({ sector: event.currentTarget.value }) }}>
          <option value="" disabled>Alege sectorul</option>
          {[1, 2, 3, 4, 5, 6].map((sector) => <option key={sector} value={sector}>Sector {sector}</option>)}
        </Select>
        <FieldIssue issue={issue} field="sector" form={ISSUER_FORM} />
      </Field>
      : null}
    <Field label="Cod poștal" optional>
      <Input disabled={disabled} value={form.postalCode}
        onChange={(event) => { props.onChange({ postalCode: event.currentTarget.value }) }} />
    </Field>
  </div>
}
