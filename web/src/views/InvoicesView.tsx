import { useQuery } from "@tanstack/react-query"

import { runUiEffect } from "../api.ts"
import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { money } from "../format.ts"
import { invoicingClient } from "../invoicing-client.ts"

export const InvoicesView = () => {
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listInvoices(), signal) })
  if (invoices.isPending) return <Loading />
  if (invoices.error !== null) return <Page title="Facturi" eyebrow="Documente emise"><ErrorAlert error={invoices.error} /></Page>
  return <Page title="Facturi" eyebrow="Documente emise" actions={<a className="button primary" href="#/invoices/new">Factură nouă</a>}>
    <section className="card">
      <div className="section-heading"><div><h2>Registru facturi</h2><p>Snapshot-uri fiscale imuabile, ordonate după emitere.</p></div><span className="count">{invoices.data.length}</span></div>
      {invoices.data.length === 0 ? <EmptyState>Nu există încă facturi emise.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Număr</th><th>Client</th><th>Emisă</th><th>Scadență</th><th>Total</th><th>Status</th></tr></thead><tbody>{invoices.data.map((invoice) => <tr key={invoice.id} className="clickable-row"><td><a href={`#/invoices/${encodeURIComponent(invoice.id)}`}><strong>{invoice.series} {invoice.number}</strong></a></td><td>{invoice.customer.legalName}</td><td>{invoice.issueDate}</td><td>{invoice.dueDate}</td><td>{money(invoice.totalIncludingTax, invoice.currency)}</td><td><span className="badge">{invoice.eFacturaStatus}</span></td></tr>)}</tbody></table></div>}
    </section>
  </Page>
}
