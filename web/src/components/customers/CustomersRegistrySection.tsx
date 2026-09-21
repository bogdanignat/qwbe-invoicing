import { EmptyState, ErrorAlert } from "../layout/AsyncState.tsx"
import { Button } from "../ui/Button.tsx"
import { LoadMore } from "../ui/LoadMore.tsx"
import type { useCustomerRegistry } from "../../hooks/customer-registry-hooks.ts"
import { identifierLabel } from "../../lib/invoice-authoring-state.ts"

export const CustomersRegistrySection = ({ state }: { readonly state: ReturnType<typeof useCustomerRegistry> }) => {
  const items = state.customers.items ?? []
  return <section className="card overview-section">
    <div className="section-heading"><div><h2>Registru clienți</h2><p>Clienții salvați precompletează datele și termenul de plată al unei facturi noi.</p></div><span className="count">{items.length}</span></div>
    {state.removal.error === null ? null : <ErrorAlert error={state.removal.error} />}
    {items.length === 0 ? <EmptyState>Nu există încă niciun client activ. Poți emite facturi și pentru clienți ocazionali.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>Identificator</th><th>Adresă</th><th>Termen</th><th><span className="sr-only">Acțiuni</span></th></tr></thead><tbody>{items.map((customer) => <tr key={customer.id}><td data-label="Client"><strong>{customer.name}</strong><small>{customer.partyType === "company" ? "PJ" : "PF"}</small></td><td data-label="Identificator">{identifierLabel(customer.partyType)}: {customer.fiscalIdentifier === "" ? "—" : customer.fiscalIdentifier}</td><td data-label="Adresă">{customer.address.street}, {customer.address.city}</td><td data-label="Termen">{customer.defaultPaymentTermDays === undefined ? "Implicit firmă" : `${String(customer.defaultPaymentTermDays)} zile`}</td><td data-label="Acțiuni" className="row-actions"><div className="table-actions"><Button variant="ghost" size="small" disabled={state.save.isPending || state.removal.isPending} onClick={() => { state.edit(customer) }}>Editează</Button><Button variant="danger" size="small" disabled={state.removal.isPending} onClick={() => { state.remove(customer) }}>Șterge</Button></div></td></tr>)}</tbody></table></div>}
    <LoadMore visible={state.customers.hasMore} pending={state.customers.loadingMore} onClick={state.customers.loadMore} />
  </section>
}
