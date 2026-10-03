"use client"

import { Field } from "../ui/Field.tsx"
import { FieldIssue } from "../registry/FieldIssue.tsx"
import { Input } from "../ui/Input.tsx"
import { Select } from "../ui/Select.tsx"
import { ISSUER_FORM, type RegistryFieldAria } from "../../lib/registry-fields.ts"
import type { IssuerField } from "../../lib/issuer-payload.ts"
import type { IssuerSettingsForm } from "../../lib/issuer-form.ts"
import type { RegistryEditorIssue } from "../../hooks/use-registry-editor.ts"

interface IssuerVatFieldsProps {
  readonly form: IssuerSettingsForm
  readonly disabled: boolean
  readonly issue: RegistryEditorIssue<IssuerField> | undefined
  readonly aria: (field: IssuerField) => RegistryFieldAria
  /** What the regime is, or what the unsaved choice changed about it. */
  readonly vatStatus: string
  readonly onChange: (patch: Partial<IssuerSettingsForm>) => void
  readonly onVatRegisteredChange: (registered: boolean) => void
}

/**
 * The invoicing defaults and the only part of the VAT regime that may be
 * changed: whether the issuer charges VAT, and from which day.
 *
 * The rates are not a field. Choosing "plătitoare" writes the standard
 * configuration and choosing the opposite writes the Article 310 exemption —
 * the backend decides, because a rate is a fiscal fact and not a preference.
 * The date is the one the regime applies from, which is *not* the day the form
 * is saved: a change may be scheduled ahead, and documents keep the
 * configuration in force on their own issuance date.
 */
export const IssuerVatFields = (props: IssuerVatFieldsProps) => {
  const { form, disabled, issue, aria } = props
  return <>
    <div className="form-grid">
      <Field label="Monedă implicită">
        <Select value="RON" disabled><option value="RON">Leu românesc (RON)</option></Select>
      </Field>
      <Field label="Termen de plată (zile)" required>
        <Input required disabled={disabled} value={form.defaultPaymentTermDays} inputMode="numeric"
          pattern="[0-9]*" title="Număr întreg de zile, între 0 și 3650" {...aria("defaultPaymentTermDays")}
          onChange={(event) => { props.onChange({ defaultPaymentTermDays: event.currentTarget.value }) }} />
        <FieldIssue issue={issue} field="defaultPaymentTermDays" form={ISSUER_FORM} />
      </Field>
      <label className="checkbox-label">
        <input type="checkbox" disabled={disabled} checked={form.vatRegistered} {...aria("vatRegistered")}
          onChange={(event) => { props.onVatRegisteredChange(event.currentTarget.checked) }} /> Plătitoare de TVA
      </label>
      <FieldIssue issue={issue} field="vatRegistered" form={ISSUER_FORM} />
      <Field label="Schimbarea regimului se aplică de la" required>
        <Input required type="date" disabled={disabled} value={form.vatEffectiveFrom} {...aria("vatEffectiveFrom")}
          onChange={(event) => { props.onChange({ vatEffectiveFrom: event.currentTarget.value }) }} />
        <FieldIssue issue={issue} field="vatEffectiveFrom" form={ISSUER_FORM} />
      </Field>
    </div>
    {form.vatRegistered
      ? null
      : <p className="hint">Informațiile fiscale pentru regimul art. 310 se completează automat. Alte regimuri de scutire nu sunt încă suportate.</p>}
    <p className="hint">Regimul TVA este ales explicit și independent de forma în care introduci CUI-ul. Pentru o firmă nouă, temeiul art. 310 nu este selectat automat.</p>
    <p className="status-note" aria-live="polite">{props.vatStatus}</p>
  </>
}
