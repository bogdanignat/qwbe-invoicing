import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { runUiEffect } from "../api.ts"
import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { money } from "../format.ts"
import { invoicingClient } from "../invoicing-client.ts"

export const InvoicesView = () => {
  const queryClient = useQueryClient()
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listInvoices(), signal) })
  const drafts = useQuery({ queryKey: ["drafts"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listDrafts(), signal) })
  const removeDraft = useMutation({
    mutationFn: (id: string) => runUiEffect(invoicingClient.deleteDraft(id)),
    onSuccess: async (_result, id) => { queryClient.removeQueries({ queryKey: ["draft", id], exact: true }); await queryClient.invalidateQueries({ queryKey: ["drafts"] }) },
  })
  if (invoices.data === undefined && invoices.isPending) return <Loading />
  if (invoices.data === undefined) return <Page title="Facturi" eyebrow="Documente și drafturi"><ErrorAlert error={invoices.error} /></Page>
  const draftItems = drafts.data ?? []
  const invoiceItems = invoices.data
  return <Page title="Facturi" eyebrow="Documente și drafturi" actions={<a className="button primary" href="/invoices/new">Factură nouă</a>}>
    {invoices.error === null ? null : <ErrorAlert error={invoices.error} />}
    <section className="card overview-section">
      <div className="section-heading"><div><h2>Drafturi deschise</h2><p>Continuă editarea sau șterge documentele de lucru care nu mai sunt necesare.</p></div><span className="count">{draftItems.length}</span></div>
      {removeDraft.error === null ? null : <ErrorAlert error={removeDraft.error} />}
      {drafts.error === null ? null : <ErrorAlert error={drafts.error} />}
      {drafts.data === undefined && drafts.isPending ? <p className="status-note" role="status">Se încarcă drafturile…</p> : draftItems.length === 0 ? <EmptyState>Nu există drafturi deschise.</EmptyState> : <div className="table-wrap"><table><caption className="sr-only">Drafturi deschise</caption><thead><tr><th>Serie</th><th>Cumpărător</th><th>Emisă</th><th>Scadență</th><th>Total</th><th><span className="sr-only">Acțiuni</span></th></tr></thead><tbody>{draftItems.map((draft) => <tr key={draft.id}><td data-label="Serie"><a href={`/drafts/${encodeURIComponent(draft.id)}`}><strong>{draft.series}</strong><small>Reia editarea</small></a></td><td data-label="Cumpărător">{draft.customer.legalName}<small>{draft.customer.partyType === "company" ? "PJ" : "PF"}{draft.customer.taxIdentifier === "" ? "" : ` · ${draft.customer.taxIdentifier}`}</small></td><td data-label="Emisă">{draft.issueDate}</td><td data-label="Scadență">{draft.dueDate}</td><td data-label="Total">{money(draft.totalIncludingTax, draft.currency)}</td><td className="row-actions" data-label="Acțiuni"><button className="button danger ghost small" type="button" disabled={removeDraft.isPending} onClick={() => { if (window.confirm(`Ștergi draftul pentru „${draft.customer.legalName}”?`)) removeDraft.mutate(draft.id) }}>Șterge</button></td></tr>)}</tbody></table></div>}
    </section>
    <section className="card">
      <div className="section-heading"><div><h2>Registru de facturi</h2><p>Snapshot-uri fiscale imuabile, ordonate după emitere.</p></div><span className="count">{invoiceItems.length}</span></div>
      {invoiceItems.length === 0 ? <EmptyState>Nu există încă facturi emise.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Număr</th><th>Client</th><th>Emisă</th><th>Scadență</th><th>Total</th><th>Status</th></tr></thead><tbody>{invoiceItems.map((invoice) => <tr key={invoice.id} className="clickable-row"><td><a href={`/invoices/${encodeURIComponent(invoice.id)}`}><strong>{invoice.series} {invoice.number}</strong></a></td><td>{invoice.customer.legalName}</td><td>{invoice.issueDate}</td><td>{invoice.dueDate}</td><td>{money(invoice.totalIncludingTax, invoice.currency)}</td><td><span className="badge">{invoice.eFacturaStatus}</span></td></tr>)}</tbody></table></div>}
    </section>
  </Page>
}
