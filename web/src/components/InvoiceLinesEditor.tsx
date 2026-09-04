import type { EditableInvoiceLine } from "../invoice-authoring-state.ts"
import type { ProductPreset, TaxConfiguration } from "../models.ts"

interface InvoiceLinesEditorProps {
  readonly lines: ReadonlyArray<EditableInvoiceLine>
  readonly productPresets: ReadonlyArray<ProductPreset>
  readonly taxConfigurations: ReadonlyArray<TaxConfiguration>
  readonly issueDate: string
  readonly pending: boolean
  readonly onAdd: () => void
  readonly onChange: (key: string, patch: Partial<EditableInvoiceLine>) => void
  readonly onApplyPreset: (lineKey: string, presetId: string) => void
  readonly onDelete: (line: EditableInvoiceLine) => void
}

export const InvoiceLinesEditor = ({ lines, productPresets, taxConfigurations, issueDate, pending, onAdd, onChange, onApplyPreset, onDelete }: InvoiceLinesEditorProps) => {
  const taxes = taxConfigurations.filter((tax) => tax.effectiveFrom <= issueDate && (tax.effectiveTo === undefined || issueDate <= tax.effectiveTo))
  return <section className="card authoring-section">
    <div className="section-heading"><div><h2>4. Produse și servicii</h2><p>Alege un produs predefinit sau completează linia manual.</p></div><button className="button secondary small" type="button" disabled={pending} onClick={onAdd}>Adaugă linie</button></div>
    <div className="line-editor-list">{lines.map((line, index) => <fieldset className="line-editor" key={line.key}><legend>Linia {String(index + 1)}{line.lineId === undefined ? " — nesalvată" : ""}</legend>
      {productPresets.length === 0 ? null : <label className="line-preset">Produs predefinit<select disabled={pending} value="" onChange={(event) => { onApplyPreset(line.key, event.currentTarget.value) }}><option value="">Alege pentru precompletare</option>{productPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.description} — {preset.unitPrice} RON</option>)}</select></label>}
      <div className="line-fields"><label>Descriere<input required disabled={pending} value={line.description} onChange={(event) => { onChange(line.key, { description: event.currentTarget.value }) }} /></label><label>Cantitate<input required disabled={pending} inputMode="decimal" value={line.quantity} onChange={(event) => { onChange(line.key, { quantity: event.currentTarget.value }) }} /></label><label>Preț unitar fără TVA<input required disabled={pending} inputMode="decimal" value={line.unitPrice} onChange={(event) => { onChange(line.key, { unitPrice: event.currentTarget.value }) }} /></label><label>TVA<select required disabled={pending} value={line.taxCode} onChange={(event) => { onChange(line.key, { taxCode: event.currentTarget.value }) }}><option value="" disabled>Alege TVA</option>{taxes.map((tax) => <option key={`${tax.code}-${tax.effectiveFrom}`} value={tax.code}>{tax.rate}% — {tax.code}</option>)}</select></label></div>
      <div className="line-actions"><button className="button danger ghost small" type="button" aria-label={`Șterge linia ${String(index + 1)}: ${line.description || "linie fără descriere"}`} disabled={pending} onClick={() => { onDelete(line) }}>Șterge linia</button></div>
    </fieldset>)}</div>
    {lines.length === 0 ? <button className="button secondary" type="button" disabled={pending} onClick={onAdd}>Adaugă prima linie manuală</button> : null}
  </section>
}
