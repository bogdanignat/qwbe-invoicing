import { Button } from "../Button.tsx"
import { EmptyState, ErrorAlert } from "../AsyncState.tsx"
import type { EFacturaReconciliationModel } from "../../hooks/use-efactura-reconciliation.ts"

/**
 * An `unknown` submission: search ANAF's list for its upload, link the one the
 * user recognises, or resubmit. Both writes ask for an explicit confirmation
 * (`use-efactura-reconciliation.ts`); nothing is linked or sent on its own.
 */
export const EFacturaReconciliation = ({ model }: { readonly model: EFacturaReconciliationModel }) => {
  const { candidates } = model
  const busy = model.pending || model.searching
  return <section className="grid gap-3" aria-labelledby="efactura-reconcile-title">
    <h3 id="efactura-reconcile-title" className="m-0">Reconciliere</h3>
    <p className="hint">Caută în lista ANAF încărcările acestui CIF din perioada trimiterii. Leagă doar mesajul pe care îl recunoști ca fiind acest document; dacă nu-l găsești, îl poți retrimite.</p>
    <div className="button-row">
      <Button className="secondary" disabled={busy} onClick={model.search}>{model.searching ? "Se caută…" : "Caută la ANAF"}</Button>
      <Button className="danger" disabled={busy} onClick={model.resubmit}>Retrimite</Button>
    </div>
    {model.searchError === undefined ? null : <ErrorAlert error={model.searchError} />}
    {model.failure === undefined ? null : <ErrorAlert error={model.failure} />}
    {candidates === undefined ? null : <>
      <p className="hint">{candidates.window}</p>
      {candidates.rows.length === 0
        ? <EmptyState>ANAF nu listează nicio încărcare a acestui CIF în perioada trimiterii.</EmptyState>
        : <ul className="m-0 list-none p-0">
          {candidates.rows.map((row) => <li key={row.uploadIndex} className="draft-item">
            <div className="draft-item-main">
              <strong>Index {row.uploadIndex}</strong>
              <small>{row.date} · {row.type}</small>
            </div>
            <div className="draft-item-actions">
              <Button className="secondary small" disabled={busy || row.linked} onClick={() => { model.link(row.uploadIndex) }}>
                {row.linkLabel}
              </Button>
            </div>
          </li>)}
        </ul>}
      {candidates.pageLabel === undefined
        ? null
        : <nav className="button-row items-center" aria-label="Paginile listei ANAF">
          <PageButton label="Pagina anterioară" page={candidates.previous} disabled={busy} goTo={model.goTo} />
          <span className="hint">{candidates.pageLabel}</span>
          <PageButton label="Pagina următoare" page={candidates.next} disabled={busy} goTo={model.goTo} />
        </nav>}
    </>}
  </section>
}

const PageButton = ({ label, page, disabled, goTo }: {
  readonly label: string
  readonly page: number | undefined
  readonly disabled: boolean
  readonly goTo: (page: number) => void
}) => <Button className="secondary small" disabled={disabled || page === undefined} onClick={() => { if (page !== undefined) goTo(page) }}>
  {label}
</Button>
