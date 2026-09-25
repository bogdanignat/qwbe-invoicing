"use client"

import { Button } from "../Button.tsx"
import { ErrorAlert } from "../AsyncState.tsx"
import { Field } from "../ui/Field.tsx"
import { Input } from "../ui/Input.tsx"
import { Select } from "../ui/Select.tsx"
import { FieldIssue } from "./FieldIssue.tsx"
import { useEditorHeadingFocus } from "../../hooks/use-editor-heading-focus.ts"
import { useRefusedFieldFocus } from "../../hooks/use-refused-field-focus.ts"
import { PRODUCT_FORM, registryFieldAria } from "../../lib/registry-fields.ts"
import { PRODUCT_PRICE_PATTERN, type ProductPresetField, type ProductPresetForm } from "../../lib/product-preset-form.ts"
import type { PresetVatOption } from "../../lib/product-preset-vat.ts"
import type { RegistryEditorIssue } from "../../hooks/use-registry-editor.ts"
import type { UnitOfMeasure } from "../../lib/draft-models.ts"

interface ProductPresetEditorSectionProps {
  readonly form: ProductPresetForm
  /** The product being edited; absent while a new one is created. */
  readonly editingId: string | undefined
  readonly units: ReadonlyArray<UnitOfMeasure>
  readonly vatOptions: ReadonlyArray<PresetVatOption>
  readonly issue: RegistryEditorIssue<ProductPresetField> | undefined
  readonly pending: boolean
  readonly error: unknown
  readonly onChange: (patch: Partial<ProductPresetForm>) => void
  readonly onSubmit: () => void
  readonly onClose: () => void
}

/** The product editor: one controlled form, and the refusal the model named. */
export const ProductPresetEditorSection = (props: ProductPresetEditorSectionProps) => {
  const { editingId, form, issue, pending } = props
  const headingRef = useEditorHeadingFocus(editingId ?? "new")
  useRefusedFieldFocus(PRODUCT_FORM, issue?.field)
  const aria = registryFieldAria(PRODUCT_FORM, issue?.field)
  const refusal = (field: ProductPresetField) => <FieldIssue issue={issue} field={field} form={PRODUCT_FORM} />
  return <section className="card">
    <div className="section-heading"><div>
      <h2 ref={headingRef} tabIndex={-1}>{editingId === undefined ? "Produs nou" : "Editezi produsul"}</h2>
      <p>Prețul se scrie fără TVA, cu maximum două zecimale.</p>
    </div></div>
    {props.error === null || props.error === undefined ? null : <ErrorAlert error={props.error} />}
    <form className="authoring-section" onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>
      <div className="form-grid">
        <Field label="Descriere" required className="span-two">
          <Input required disabled={pending} value={form.description} {...aria("description")}
            onChange={(event) => { props.onChange({ description: event.currentTarget.value }) }} />
          {refusal("description")}
        </Field>
        <Field label="Unitate de măsură" required>
          <Select required disabled={pending} value={form.unitOfMeasureCode} {...aria("unitOfMeasure")}
            onChange={(event) => { props.onChange({ unitOfMeasureCode: event.currentTarget.value }) }}>
            <option value="" disabled>Alege unitatea</option>
            {props.units.map((unit) => <option key={unit.code} value={unit.code}>{unit.name} ({unit.code})</option>)}
          </Select>
          {refusal("unitOfMeasure")}
        </Field>
        <Field label="Preț unitar (RON, fără TVA)" required>
          <Input required disabled={pending} value={form.unitPrice} inputMode="decimal"
            pattern={PRODUCT_PRICE_PATTERN} {...aria("unitPrice")}
            title="Număr nenegativ cu maximum două zecimale"
            onChange={(event) => { props.onChange({ unitPrice: event.currentTarget.value }) }} />
          {refusal("unitPrice")}
        </Field>
        <Field label="Cotă TVA preferată" className="span-two">
          <Select disabled={pending} value={form.preferredVatRateCode} {...aria("preferredVatRateCode")}
            onChange={(event) => { props.onChange({ preferredVatRateCode: event.currentTarget.value }) }}>
            {props.vatOptions.map((option) =>
              <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          {refusal("preferredVatRateCode")}
        </Field>
      </div>
      <div className="button-row">
        <Button type="submit" disabled={pending}>{pending ? "Se salvează…" : "Salvează produsul"}</Button>
        <Button className="secondary" disabled={pending} onClick={props.onClose}>Renunță</Button>
      </div>
    </form>
  </section>
}
