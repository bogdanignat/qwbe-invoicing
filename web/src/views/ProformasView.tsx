import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { LoadMore } from "../components/LoadMore.tsx"
import { Page } from "../components/Page.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { money } from "../format.ts"
import { useProformas } from "../proforma-hooks.ts"
import { proformaStatusPresentation } from "../proforma-state.ts"

export const ProformasView = () => {
  const proformas = useProformas()
  const items = proformas.items
  if (items === undefined && proformas.isPending) return <Loading />
  if (items === undefined) return <Page title="Proforme" eyebrow="Documente comerciale"><ErrorAlert error={proformas.error} /></Page>
  return <Page title="Proforme" eyebrow="Documente comerciale" actions={<ButtonLink href="/invoices/new">Document nou</ButtonLink>}>
    {proformas.error === null ? null : <ErrorAlert error={proformas.error} />}
    <section className="card">
      <div className="section-heading"><div><h2>Registru de proforme</h2><p>Poți emite o proformă direct dintr-un document nou sau dintr-un draft salvat.</p></div><span className="count">{items.length}</span></div>
      {items.length === 0 ? <EmptyState>Nu există încă proforme emise.</EmptyState> : <div className="table-wrap"><table><caption className="sr-only">Registru de proforme</caption><thead><tr><th>Număr</th><th>Client</th><th>Emisă</th><th>Scadență</th><th>Total</th><th>Status</th></tr></thead><tbody>{items.map((proforma) => { const status = proformaStatusPresentation(proforma); return <tr key={proforma.id} className="clickable-row"><td><a href={`/proformas/${encodeURIComponent(proforma.id)}`}><strong>{proforma.series} {proforma.number}</strong></a></td><td>{proforma.customer.name}</td><td>{proforma.issueDate}</td><td>{proforma.dueDate ?? "—"}</td><td>{money(proforma.totalIncludingVat, proforma.currency)}</td><td><span className={`badge ${status.tone}`}>{status.label}</span></td></tr> })}</tbody></table></div>}
      <LoadMore visible={proformas.hasMore} pending={proformas.loadingMore} onClick={proformas.loadMore} />
    </section>
  </Page>
}
