import { useEffect, useRef } from "react"

import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { focusAndReveal } from "../focus.ts"
import { money } from "../format.ts"
import { useProductPresetsRegistry } from "../product-presets-hooks.ts"

export const ProductPresetsView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const state = useProductPresetsRegistry(notify)
  const editHeading = useRef<HTMLHeadingElement>(null)
  const editing = state.editing
  useEffect(() => {
    if (editing === undefined) return
    focusAndReveal(editHeading.current)
  }, [editing])
  const presets = state.presets.data
  if (presets === undefined) return state.presets.error === null
    ? <Loading />
    : <Page title="Produse și servicii" eyebrow="Preseturi facturare"><ErrorAlert error={state.presets.error} /></Page>
  const items = presets
  return <Page title="Produse și servicii" eyebrow="Preseturi facturare" actions={<ButtonLink href="/invoices/new">Factură nouă</ButtonLink>}>
    <div className="split-layout">
      <section className="card overview-section">
        <div className="section-heading"><div><h2>Produse predefinite</h2><p>Lista precompletează descrierea și prețul unei linii; factura păstrează propria copie.</p></div><span className="count">{items.length}</span></div>
        {state.removal.error === null ? null : <ErrorAlert error={state.removal.error} />}
        {items.length === 0 ? <EmptyState>Nu există încă produse predefinite. Liniile facturii pot fi completate în continuare manual.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Descriere</th><th>Preț unitar fără TVA</th><th><span className="sr-only">Acțiuni</span></th></tr></thead><tbody>{items.map((preset) => <tr key={preset.id}><td data-label="Descriere"><strong>{preset.description}</strong></td><td data-label="Preț">{money(preset.unitPrice, "RON")}</td><td data-label="Acțiuni" className="row-actions"><div className="table-actions"><Button variant="ghost" size="small" disabled={state.save.isPending || state.removal.isPending} onClick={() => { state.edit(preset) }}>Editează</Button><Button variant="danger" size="small" disabled={state.removal.isPending} onClick={() => { state.remove(preset) }}>Șterge</Button></div></td></tr>)}</tbody></table></div>}
      </section>
      <section className="card sticky-card"><h2 ref={editHeading} tabIndex={-1} aria-live="polite">{editing === undefined ? "Produs nou" : "Editează produsul"}</h2><p>Doar descrierea și prețul sunt salvate ca preset.</p>{state.save.error === null ? null : <ErrorAlert error={state.save.error} />}<form key={editing?.id ?? "new"} onSubmit={state.submit}><label>Descriere<input name="description" required defaultValue={editing?.description ?? ""} /></label><label>Preț unitar fără TVA<input name="unitPrice" required inputMode="decimal" pattern="\d+(?:[.,]\d{1,2})?" title="Număr nenegativ cu maximum două zecimale" defaultValue={editing?.unitPrice ?? ""} /></label><div className="form-actions">{editing === undefined ? null : <Button variant="ghost" disabled={state.save.isPending} onClick={state.cancelEdit}>Renunță</Button>}<Button type="submit" disabled={state.save.isPending}>{state.save.isPending ? "Se salvează…" : editing === undefined ? "Adaugă produs" : "Salvează modificările"}</Button></div></form></section>
    </div>
  </Page>
}
