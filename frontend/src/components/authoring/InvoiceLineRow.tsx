"use client"

import type { EditableInvoiceLine } from "../../lib/invoice-authoring-model.ts"
import type { ProductPreset, UnitOfMeasure, VatCatalogue } from "../../lib/draft-models.ts"
import { Field } from "../ui/Field.tsx"
import { Input } from "../ui/Input.tsx"
import { Select } from "../ui/Select.tsx"
import { Button } from "../Button.tsx"
import { vatTreatmentLabel } from "../../lib/vat-snapshots.ts"

interface InvoiceLineRowProps {
  readonly line: EditableInvoiceLine
  readonly index: number
  readonly productPresets: ReadonlyArray<ProductPreset>
  readonly vatRates: ReadonlyArray<VatCatalogue["rates"][number]>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly pending: boolean
  readonly onChange: (key: string, patch: Partial<EditableInvoiceLine>) => void
  readonly onApplyPreset: (lineKey: string, presetId: string) => void
  readonly onDelete: (line: EditableInvoiceLine) => void
}

/** One line of the document: preset prefill, amounts, unit and the VAT code resolved on the document date. */
export const InvoiceLineRow = (props: InvoiceLineRowProps) => {
  const { line, index, productPresets, vatRates, unitOfMeasures, pending } = props
  return <fieldset className="line-editor">
    <legend>Linia {String(index + 1)}{line.lineId === undefined ? " — nesalvată" : ""}</legend>
    {productPresets.length === 0 ? null : <Field label="Produs predefinit">
      <Select disabled={pending} value="" onChange={(event) => { props.onApplyPreset(line.key, event.currentTarget.value) }}>
        <option value="">Alege pentru precompletare</option>
        {productPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.description} — {preset.unitPrice} RON</option>)}
      </Select>
    </Field>}
    <div className="line-fields">
      <Field label="Descriere" required>
        <Input required disabled={pending} value={line.description} onChange={(event) => { props.onChange(line.key, { description: event.currentTarget.value }) }} />
      </Field>
      <Field label="Cantitate" required>
        <Input required disabled={pending} inputMode="decimal" value={line.quantity} onChange={(event) => { props.onChange(line.key, { quantity: event.currentTarget.value }) }} />
      </Field>
      <Field label="U.M." required>
        <Select required disabled={pending} value={line.unitOfMeasure.code}
          onChange={(event) => {
            const selected = unitOfMeasures.find(({ code }) => code === event.currentTarget.value)
            if (selected !== undefined) props.onChange(line.key, { unitOfMeasure: selected })
          }}>
          <option value="" disabled>Alege U.M.</option>
          {unitOfMeasures.map((unit) => <option key={unit.code} value={unit.code}>{unit.name} — {unit.code}</option>)}
        </Select>
      </Field>
      <Field label="Preț unitar fără TVA" required>
        <Input required disabled={pending} inputMode="decimal" value={line.unitPrice} onChange={(event) => { props.onChange(line.key, { unitPrice: event.currentTarget.value }) }} />
      </Field>
      <Field label="TVA" required>
        <Select required disabled={pending} value={line.vatRateCode} onChange={(event) => { props.onChange(line.key, { vatRateCode: event.currentTarget.value }) }}>
          <option value="" disabled>Alege TVA</option>
          {vatRates.map((tax) => <option key={`${tax.code}-${tax.effectiveFrom}`} value={tax.code}>{vatTreatmentLabel(tax)}</option>)}
        </Select>
      </Field>
    </div>
    <div className="line-actions">
      <Button className="danger small" aria-label={`Șterge linia ${String(index + 1)}: ${line.description || "linie fără descriere"}`}
        disabled={pending} onClick={() => { props.onDelete(line) }}>Șterge linia</Button>
    </div>
  </fieldset>
}
