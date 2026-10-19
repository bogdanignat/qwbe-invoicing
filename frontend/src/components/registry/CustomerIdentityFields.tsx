"use client"

import { CompanyNameField } from "../company-lookup/CompanyNameField.tsx"
import { CompanyProposalCard } from "../company-lookup/CompanyProposalCard.tsx"
import { Field } from "../ui/Field.tsx"
import { FieldIssue } from "./FieldIssue.tsx"
import { Input } from "../ui/Input.tsx"
import { useCompanyLookup } from "../../hooks/use-company-lookup.ts"
import { CIUS_TEXT_LIMITS } from "../../lib/cius-text-limits.ts"
import { customerFill } from "../../lib/company-proposal-fill.ts"
import { identifierLabel } from "../../lib/document-authoring-transitions.ts"
import { CUSTOMER_FORM, type RegistryFieldAria } from "../../lib/registry-fields.ts"
import { identifierMaxLength, type CustomerField } from "../../lib/customer-payload.ts"
import { romanianCuiPattern } from "../../lib/vat-defaults.ts"
import type { CustomerForm } from "../../lib/customer-form.ts"
import type { RegistryEditorIssue } from "../../hooks/use-registry-editor.ts"

interface CustomerIdentityFieldsProps {
  readonly form: CustomerForm
  /** The customer being edited; a new one is its own scope. */
  readonly editingId: string | undefined
  readonly disabled: boolean
  readonly issue: RegistryEditorIssue<CustomerField> | undefined
  readonly aria: (field: CustomerField) => RegistryFieldAria
  readonly onChange: (patch: Partial<CustomerForm>) => void
  readonly onIdentifierChange: (value: string) => void
}

/**
 * Who the customer is: name, fiscal identifier and VAT flag. A company can be
 * completed from its CUI (or, with openapi.ro, its name); another customer or
 * another party type drops whatever was being looked up.
 */
export const CustomerIdentityFields = (props: CustomerIdentityFieldsProps) => {
  const { form, disabled, issue, aria } = props
  const company = form.partyType === "company"
  const { lookup, nameRef } = useCompanyLookup(`${props.editingId ?? "new"}:${form.partyType}`, company)
  return <>
    <CompanyNameField lookup={lookup} inputRef={nameRef} label={company ? "Denumire" : "Nume complet"} value={form.name} disabled={disabled}
      maxLength={CIUS_TEXT_LIMITS.partyName} controlAria={aria("name")} onChange={(name) => { props.onChange({ name }) }}>
      <FieldIssue issue={issue} field="name" form={CUSTOMER_FORM} />
    </CompanyNameField>
    <Field label={identifierLabel(form.partyType)} optional={!company} required={company}>
      <Input value={form.fiscalIdentifier} required={company} disabled={disabled}
        maxLength={identifierMaxLength(form.partyType)} {...aria("fiscalIdentifier")}
        pattern={company ? romanianCuiPattern : "(?:[0-9]{13})?"}
        inputMode={company ? "text" : "numeric"}
        title={company ? "CUI românesc numeric; prefixul RO introdus este eliminat" : "CNP valid din 13 cifre sau câmp gol"}
        onChange={(event) => { props.onIdentifierChange(event.currentTarget.value); lookup.typeCui(event.currentTarget.value) }} />
      <FieldIssue issue={issue} field="fiscalIdentifier" form={CUSTOMER_FORM} />
    </Field>
    <CompanyProposalCard lookup={lookup} vat="suggested" disabled={disabled}
      onApply={(proposal) => { props.onChange(customerFill(form, proposal)) }} />
    {company
      ? <label className="checkbox-label"><input type="checkbox" checked={form.vatRegistered} disabled={disabled}
        onChange={(event) => { props.onChange({ vatRegistered: event.currentTarget.checked }) }} /> Client înregistrat în scopuri de TVA</label>
      : null}
  </>
}
