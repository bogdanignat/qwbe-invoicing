import type { EditableInvoiceLine } from "../invoice-authoring-state.ts"
import type { ProductPreset, TaxConfiguration, UnitOfMeasure } from "../models.ts"
import { Button } from "./ui/Button.tsx"

interface InvoiceLinesEditorProps {
  readonly lines: ReadonlyArray<EditableInvoiceLine>
  readonly productPresets: ReadonlyArray<ProductPreset>
  readonly taxConfigurations: ReadonlyArray<TaxConfiguration>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly issueDate: string
  readonly pending: boolean
  readonly onAdd: () => void
  readonly onChange: (key: string, patch: Partial<EditableInvoiceLine>) => void
  readonly onApplyPreset: (lineKey: string, presetId: string) => void
  readonly onDelete: (line: EditableInvoiceLine) => void
}

export const InvoiceLinesEditor = ({ lines, productPresets, taxConfigurations, unitOfMeasures, issueDate, pending, onAdd, onChange, onApplyPreset, onDelete }: InvoiceLinesEditorProps) => {
  const taxes = taxConfigurations.filter((tax) => tax.effectiveFrom <= issueDate && (tax.effectiveTo === undefined || issueDate <= tax.effectiveTo))
  return <section className="card authoring-section">
    <div className="section-heading"><div><h2>4. Produse și servicii</h2><p>Alege un produs predefinit sau completează linia manual.</p></div><Button variant="secondary" size="small" disabled={pending} onClick={onAdd}>Adaugă linie</Button></div>
    <div className="line-editor-list">{lines.map((line, index) => <fieldset className="line-editor" key={line.key}><legend>Linia {String(index + 1)}{line.lineId === undefined ? " — nesalvată" : ""}</legend>
      {productPresets.length === 0 ? null : <label className="line-preset">Produs predefinit<select disabled={pending} value="" onChange={(event) => { onApplyPreset(line.key, event.currentTarget.value) }}><option value="">Alege pentru precompletare</option>{productPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.description} — {preset.unitPrice} RON</option>)}</select></label>}
      <div className="line-fields"><label>Descriere<input required disabled={pending} value={line.description} onChange={(event) => { onChange(line.key, { description: event.currentTarget.value }) }} /></label><label>Cantitate<input required disabled={pending} inputMode="decimal" value={line.quantity} onChange={(event) => { onChange(line.key, { quantity: event.currentTarget.value }) }} /></label><label>U.M.<select required disabled={pending} value={line.unitOfMeasure.code} onChange={(event) => { const selected = unitOfMeasures.find(({ code }) => code === event.currentTarget.value); if (selected !== undefined) onChange(line.key, { unitOfMeasure: selected }) }}><option value="" disabled>Alege U.M.</option>{unitOfMeasures.map((unit) => <option key={unit.code} value={unit.code}>{unit.name} — {unit.code}</option>)}</select></label><label>Preț unitar fără TVA<input required disabled={pending} inputMode="decimal" value={line.unitPrice} onChange={(event) => { onChange(line.key, { unitPrice: event.currentTarget.value }) }} /></label><label>TVA<select required disabled={pending} value={line.taxCode} onChange={(event) => { onChange(line.key, { taxCode: event.currentTarget.value }) }}><option value="" disabled>Alege TVA</option>{taxes.map((tax) => <option key={`${tax.code}-${tax.effectiveFrom}`} value={tax.code}>{tax.rate}% — {tax.code}</option>)}</select></label></div>
      <div className="line-actions"><Button variant="danger" size="small" aria-label={`Șterge linia ${String(index + 1)}: ${line.description || "linie fără descriere"}`} disabled={pending} onClick={() => { onDelete(line) }}>Șterge linia</Button></div>
    </fieldset>)}</div>
    {lines.length === 0 ? <Button variant="secondary" disabled={pending} onClick={onAdd}>Adaugă prima linie manuală</Button> : null}
  </section>
}
