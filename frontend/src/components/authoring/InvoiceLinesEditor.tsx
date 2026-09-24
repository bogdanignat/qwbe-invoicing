"use client"

import type { EditableInvoiceLine } from "../../lib/invoice-authoring-model.ts"
import type { ProductPreset, UnitOfMeasure, VatCatalogue } from "../../lib/draft-models.ts"
import { InvoiceLineRow } from "./InvoiceLineRow.tsx"
import { Button } from "../Button.tsx"

interface InvoiceLinesEditorProps {
  readonly lines: ReadonlyArray<EditableInvoiceLine>
  readonly productPresets: ReadonlyArray<ProductPreset>
  readonly presetsHasMore: boolean
  readonly presetsLoadingMore: boolean
  readonly onPresetsLoadMore: () => void
  readonly vatRates: ReadonlyArray<VatCatalogue["rates"][number]>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly pending: boolean
  readonly onAdd: () => void
  readonly onChange: (key: string, patch: Partial<EditableInvoiceLine>) => void
  readonly onApplyPreset: (lineKey: string, presetId: string) => void
  readonly onDelete: (line: EditableInvoiceLine) => void
}

/** The lines of the document, and the product presets that prefill them, one cursor page at a time. */
export const InvoiceLinesEditor = (props: InvoiceLinesEditorProps) => <section className="card authoring-section">
  <div className="section-heading">
    <div><h2>Produse și servicii</h2><p>Alege un produs predefinit sau completează linia manual.</p></div>
    <Button className="secondary small" disabled={props.pending} onClick={props.onAdd}>Adaugă linie</Button>
  </div>
  {props.presetsHasMore
    ? <p className="hint">
      Se afișează primele produse predefinite.{" "}
      <Button className="secondary small" disabled={props.presetsLoadingMore} onClick={props.onPresetsLoadMore}>
        {props.presetsLoadingMore ? "Se încarcă…" : "Încarcă mai multe produse"}
      </Button>
    </p>
    : null}
  <div className="line-editor-list">
    {props.lines.map((line, index) => <InvoiceLineRow key={line.key} line={line} index={index}
      productPresets={props.productPresets} vatRates={props.vatRates} unitOfMeasures={props.unitOfMeasures}
      pending={props.pending} onChange={props.onChange} onApplyPreset={props.onApplyPreset} onDelete={props.onDelete}
    />)}
  </div>
  {props.lines.length === 0
    ? <Button className="secondary" disabled={props.pending} onClick={props.onAdd}>Adaugă prima linie manuală</Button>
    : null}
</section>
