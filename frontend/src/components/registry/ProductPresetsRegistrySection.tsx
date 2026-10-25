import { Button } from "../Button.tsx"
import { EmptyState } from "../AsyncState.tsx"
import { LoadMore } from "../LoadMore.tsx"
import { money } from "../../lib/money.ts"
import { productKindLabels } from "../../lib/product-preset-form.ts"
import type { ProductPresetRow } from "../../hooks/use-product-presets.ts"

interface ProductPresetsRegistrySectionProps {
  readonly rows: ReadonlyArray<ProductPresetRow>
  readonly editingId: string | undefined
  readonly disabled: boolean
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly onLoadMore: () => void
  readonly onEdit: (row: ProductPresetRow) => void
  readonly onDelete: (row: ProductPresetRow) => void
}

/**
 * The saved products, as they are reused on a document: article code, kind,
 * description, EAN, unit, price and the VAT rate the product prefers.
 *
 * The rate is a label the model already resolved — an expired preference reads
 * as such instead of as the issuer's default — so the table decides nothing.
 */
export const ProductPresetsRegistrySection = (props: ProductPresetsRegistrySectionProps) =>
  <section className="card">
    <div className="section-heading">
      <div>
        <h2>Produse salvate</h2>
        <p>Completează o linie de document dintr-un singur clic. Liniile deja scrise pe documente nu se schimbă când produsul se modifică.</p>
      </div>
      <span className="count">{props.rows.length}</span>
    </div>
    {props.rows.length === 0
      ? <EmptyState>Nu există încă produse salvate.</EmptyState>
      : <div className="table-wrap"><table>
        <thead><tr>
          <th scope="col">Cod</th><th scope="col">Tip</th><th scope="col">Descriere</th>
          <th scope="col">EAN</th><th scope="col">UM</th>
          <th scope="col" className="numeric">Preț unitar</th><th scope="col">TVA</th>
          <th scope="col"><span className="sr-only">Acțiuni</span></th>
        </tr></thead>
        <tbody>
          {props.rows.map((row) => <tr key={row.preset.id}>
            <td data-label="Cod">{row.preset.code}</td>
            <td data-label="Tip">{productKindLabels[row.preset.kind]}</td>
            <td data-label="Descriere">{row.preset.description}</td>
            <td data-label="EAN">{row.preset.barcode ?? "—"}</td>
            <td data-label="UM">{row.preset.unitOfMeasure.name}</td>
            <td data-label="Preț unitar" className="numeric">{money(row.preset.unitPrice, "RON")}</td>
            <td data-label="TVA">{row.vatLabel}</td>
            <td><div className="draft-item-actions">
              <Button className="secondary" disabled={props.disabled}
                aria-current={props.editingId === row.preset.id ? "true" : undefined}
                onClick={() => { props.onEdit(row) }}>
                Editează<span className="sr-only"> {row.preset.code} {row.preset.description}</span>
              </Button>
              <Button className="danger" disabled={props.disabled} onClick={() => { props.onDelete(row) }}>
                Șterge<span className="sr-only"> {row.preset.code} {row.preset.description}</span>
              </Button>
            </div></td>
          </tr>)}
        </tbody>
      </table></div>}
    <LoadMore visible={props.hasMore} pending={props.loadingMore} onClick={props.onLoadMore} />
  </section>
