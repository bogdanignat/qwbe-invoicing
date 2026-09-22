import { EmptyState, ErrorAlert, Loading } from "../components/layout/AsyncState.tsx"
import { LoadMore } from "../components/ui/LoadMore.tsx"
import { Page } from "../components/layout/Page.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { money } from "../lib/format.ts"
import { useInvoicesRegistry } from "../hooks/invoices-hooks.ts"

export const InvoicesView = () => {
  const state = useInvoicesRegistry()
  if (state.register.items === undefined && state.register.isPending) return <Loading />
  if (state.register.items === undefined) return <Page title="Facturi" eyebrow="Documente și drafturi"><ErrorAlert error={state.register.error} /></Page>
  const draftItems = state.drafts.items ?? []
  const registerItems = state.register.items
  return <Page title="Facturi" eyebrow="Documente și drafturi" actions={<ButtonLink href="/invoices/new">Factură nouă</ButtonLink>}>
    {state.register.error === null ? null : <ErrorAlert error={state.register.error} />}
    <section className="card overview-section">
      <div className="section-heading"><div><h2>Drafturi deschise</h2><p>Continuă editarea sau șterge documentele de lucru care nu mai sunt necesare.</p></div><span className="count">{draftItems.length}</span></div>
      {state.removal.error === null ? null : <ErrorAlert error={state.removal.error} />}
      {state.drafts.error === null ? null : <ErrorAlert error={state.drafts.error} />}
      {state.drafts.items === undefined && state.drafts.isPending ? <p className="status-note" role="status">Se încarcă drafturile…</p> : draftItems.length === 0 ? <EmptyState>Nu există drafturi deschise.</EmptyState> : <div className="table-wrap"><table><caption className="sr-only">Drafturi deschise</caption><thead><tr><th>Serie</th><th>Cumpărător</th><th>Emisă</th><th>Scadență</th><th>Total</th><th><span className="sr-only">Acțiuni</span></th></tr></thead><tbody>{draftItems.map((draft) => <tr key={draft.id}><td data-label="Serie"><a href={`/drafts/${encodeURIComponent(draft.id)}`}><strong>{draft.series}</strong><small>Reia editarea</small></a></td><td data-label="Cumpărător">{draft.customer.name}<small>{draft.customer.partyType === "company" ? "PJ" : "PF"}{draft.customer.fiscalIdentifier === "" ? "" : ` · ${draft.customer.fiscalIdentifier}`}</small></td><td data-label="Emisă">{draft.issueDate}</td><td data-label="Scadență">{draft.dueDate ?? "—"}</td><td data-label="Total">{money(draft.totalIncludingVat, draft.currency)}</td><td className="row-actions" data-label="Acțiuni"><Button variant="danger" size="small" disabled={state.removal.pending} onClick={() => { state.removal.removeDraft(draft.id, draft.customer.name) }}>Șterge</Button></td></tr>)}</tbody></table></div>}
      <LoadMore visible={state.drafts.hasMore} pending={state.drafts.loadingMore} onClick={state.drafts.loadMore} />
    </section>
    <section className="card">
      <div className="section-heading"><div><h2>Registru de facturi</h2><p>Snapshot-uri fiscale imuabile, ordonate după emitere.</p></div><span className="count">{registerItems.length}</span></div>
      {registerItems.length === 0 ? <EmptyState>Nu există încă facturi emise.</EmptyState> : <div className="table-wrap"><table><caption className="sr-only">Registru de facturi</caption><thead><tr><th>Număr</th><th>Client</th><th>Emisă</th><th>Scadență</th><th>Total</th><th>Status</th></tr></thead><tbody>{registerItems.map((row) => <tr key={row.key} className={row.documentHref === null ? undefined : "clickable-row"}><td>{row.documentHref === null ? <strong>{row.number}</strong> : <a href={row.documentHref}><strong>{row.number}</strong></a>}{row.kindLabel === null ? null : <small>{row.kindLabel}</small>}{row.originalInvoice === null ? null : <small><a href={row.originalInvoice.href}>{row.originalInvoice.label}</a></small>}</td><td>{row.customerName}</td><td>{row.issueDate}</td><td>{row.dueDate}</td><td>{row.total}</td><td><span className="badge">{row.status}</span></td></tr>)}</tbody></table></div>}
      <LoadMore visible={state.register.hasMore} pending={state.register.loadingMore} onClick={state.register.loadMore} />
    </section>
  </Page>
}
