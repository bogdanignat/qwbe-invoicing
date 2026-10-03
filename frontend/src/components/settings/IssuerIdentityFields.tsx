"use client"

import { Field } from "../ui/Field.tsx"
import { FieldIssue } from "../registry/FieldIssue.tsx"
import { Input } from "../ui/Input.tsx"
import { Select } from "../ui/Select.tsx"
import { ISSUER_FORM, type RegistryFieldAria } from "../../lib/registry-fields.ts"
import { FISCAL_IDENTIFIER_MAX_LENGTH, type IssuerField } from "../../lib/issuer-payload.ts"
import { BANK_NAME_MAX_CODE_POINTS, TRADE_REGISTRY_MAX_LENGTH } from "../../lib/issuer-legal.ts"
import { romanianCuiPattern } from "../../lib/vat-defaults.ts"
import { legalFormValue } from "../../lib/issuer-form.ts"
import type { IssuerSettingsForm } from "../../lib/issuer-form.ts"
import type { RegistryEditorIssue } from "../../hooks/use-registry-editor.ts"

interface IssuerIdentityFieldsProps {
  readonly form: IssuerSettingsForm
  readonly disabled: boolean
  readonly issue: RegistryEditorIssue<IssuerField> | undefined
  readonly aria: (field: IssuerField) => RegistryFieldAria
  readonly onChange: (patch: Partial<IssuerSettingsForm>) => void
  readonly onIdentifierChange: (value: string) => void
}

/** Who the issuer is on the document: the legal identity and the banking details printed on it. */
export const IssuerIdentityFields = (props: IssuerIdentityFieldsProps) => {
  const { form, disabled, issue, aria } = props
  return <div className="form-grid">
    <Field label="Denumire legală" required>
      <Input required disabled={disabled} value={form.name} {...aria("name")}
        onChange={(event) => { props.onChange({ name: event.currentTarget.value }) }} />
      <FieldIssue issue={issue} field="name" form={ISSUER_FORM} />
    </Field>
    <Field label="CUI / identificator fiscal" required>
      <Input required disabled={disabled} value={form.fiscalIdentifier} {...aria("fiscalIdentifier")}
        pattern={romanianCuiPattern} maxLength={FISCAL_IDENTIFIER_MAX_LENGTH}
        title="CUI românesc numeric; prefixul RO introdus este eliminat"
        onChange={(event) => { props.onIdentifierChange(event.currentTarget.value) }} />
      <FieldIssue issue={issue} field="fiscalIdentifier" form={ISSUER_FORM} />
    </Field>
    <p className="hint span-two">CUI-ul este salvat numeric; prefixul RO introdus este eliminat fără a modifica regimul TVA. Cifra de control este verificată la salvare.</p>
    <Field label="Formă juridică" required>
      <Select required disabled={disabled} value={form.legalForm} {...aria("legalForm")}
        onChange={(event) => { props.onChange({ legalForm: legalFormValue(event.currentTarget.value) }) }}>
        <option value="" disabled>Selectează forma juridică</option>
        <option value="srl">SRL</option>
        <option value="pfa">PFA</option>
      </Select>
      <FieldIssue issue={issue} field="legalForm" form={ISSUER_FORM} />
    </Field>
    <Field label="Nr. Registrul Comerțului" optional>
      <Input disabled={disabled} value={form.tradeRegistryNumber} {...aria("tradeRegistryNumber")}
        maxLength={TRADE_REGISTRY_MAX_LENGTH} placeholder="J2022000067070"
        title="Necesar la emitere: J40/1234/2020 sau J urmat de 13 cifre"
        onChange={(event) => { props.onChange({ tradeRegistryNumber: event.currentTarget.value }) }} />
      <FieldIssue issue={issue} field="tradeRegistryNumber" form={ISSUER_FORM} />
    </Field>
    <Field label="Capital social (RON)" optional>
      <Input disabled={disabled} value={form.socialCapital} {...aria("socialCapital")} inputMode="decimal"
        maxLength={21} placeholder="200.00" title="Necesar la emitere pentru SRL"
        onChange={(event) => { props.onChange({ socialCapital: event.currentTarget.value }) }} />
      <FieldIssue issue={issue} field="socialCapital" form={ISSUER_FORM} />
    </Field>
    <Field label="IBAN" optional>
      <Input disabled={disabled} value={form.iban} {...aria("iban")} autoCapitalize="characters" spellCheck={false}
        onChange={(event) => { props.onChange({ iban: event.currentTarget.value }) }} />
      <FieldIssue issue={issue} field="iban" form={ISSUER_FORM} />
    </Field>
    <Field label="Bancă" optional className="span-two">
      <Input disabled={disabled} value={form.bankName} {...aria("bankName")} maxLength={BANK_NAME_MAX_CODE_POINTS}
        onChange={(event) => { props.onChange({ bankName: event.currentTarget.value }) }} />
      <FieldIssue issue={issue} field="bankName" form={ISSUER_FORM} />
    </Field>
  </div>
}
