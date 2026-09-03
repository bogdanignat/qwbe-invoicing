import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { money } from "../format.ts"
import { useProformas } from "../proforma-hooks.ts"
import { proformaStatusLabel } from "../proforma-state.ts"

export const ProformasView = () => {
  const proformas = useProformas()
  if (proformas.data === undefined && proformas.isPending) return <Loading />
  if (proformas.data === undefined) return <Page title="Proforme" eyebrow="Documente comerciale"><ErrorAlert error={proformas.error} /></Page>
  return <Page title="Proforme" eyebrow="Documente comerciale" actions={<a className="button primary" href="/invoices/new">Document nou</a>}>
    {proformas.error === null ? null : <ErrorAlert error={proformas.error} />}
    <section className="card">
      <div className="section-heading"><div><h2>Registru de proforme</h2><p>Poți emite o proformă direct dintr-un document nou sau dintr-un draft salvat.</p></div><span className="count">{proformas.data.length}</span></div>
      {proformas.data.length === 0 ? <EmptyState>Nu există încă proforme emise.</EmptyState> : <div className="table-wrap"><table><caption className="sr-only">Registru de proforme</caption><thead><tr><th>Număr</th><th>Client</th><th>Emisă</th><th>Scadență</th><th>Total</th><th>Status</th></tr></thead><tbody>{proformas.data.map((proforma) => { const status = proformaStatusLabel(proforma); return <tr key={proforma.id} className="clickable-row"><td><a href={`/proformas/${encodeURIComponent(proforma.id)}`}><strong>{proforma.series} {proforma.number}</strong></a></td><td>{proforma.customer.legalName}</td><td>{proforma.issueDate}</td><td>{proforma.dueDate ?? "—"}</td><td>{money(proforma.totalIncludingTax, proforma.currency)}</td><td><span className={`badge ${status === "Nefacturată" ? "muted" : "positive"}`}>{status}</span></td></tr> })}</tbody></table></div>}
    </section>
  </Page>
}
