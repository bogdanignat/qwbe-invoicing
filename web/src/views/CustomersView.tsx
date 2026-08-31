import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { runUiEffect } from "../api.ts"
import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { formField, type FormSubmitEvent } from "../form.ts"
import { invoicingClient } from "../invoicing-client.ts"

export const CustomersView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const queryClient = useQueryClient()
  const customers = useQuery({ queryKey: ["customers"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listCustomers(), signal) })
  const createCustomer = useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) => runUiEffect(invoicingClient.createCustomer(body)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["customers"] }); notify("Clientul a fost creat.") },
  })
  const deleteCustomer = useMutation({
    mutationFn: (id: string) => runUiEffect(invoicingClient.deleteCustomer(id)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["customers"] }); notify("Clientul a fost șters.") },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const county = formField(form, "county")
    const postalCode = formField(form, "postalCode")
    createCustomer.mutate({
      legalName: formField(form, "legalName"), taxIdentifier: formField(form, "taxIdentifier"),
      address: { countryCode: formField(form, "countryCode"), city: formField(form, "city"), street: formField(form, "street"), ...(county === "" ? {} : { county }), ...(postalCode === "" ? {} : { postalCode }) },
    }, { onSuccess: () => { form.reset() } })
  }
  if (customers.isPending) return <Loading />
  if (customers.error !== null) return <Page title="Clienți" eyebrow="Registru"><ErrorAlert error={customers.error} /></Page>
  return <Page title="Clienți" eyebrow="Registru activ" actions={<a className="button primary" href="#/invoices/new">Factură nouă</a>}>
    <div className="split-layout">
      <section className="card">
        <div className="section-heading"><div><h2>Registru clienți</h2><p>Doar clienții activi pot fi folosiți pentru drafturi noi.</p></div><span className="count">{customers.data.length}</span></div>
        {deleteCustomer.error === null ? null : <ErrorAlert error={deleteCustomer.error} />}
        {customers.data.length === 0 ? <EmptyState>Nu există încă niciun client activ.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>CUI</th><th>Adresă</th><th><span className="sr-only">Acțiuni</span></th></tr></thead><tbody>{customers.data.map((customer) => <tr key={customer.id}><td><strong>{customer.legalName}</strong></td><td>{customer.taxIdentifier}</td><td>{customer.address.street}, {customer.address.city}</td><td className="align-right"><button className="button danger ghost compact" type="button" disabled={deleteCustomer.isPending} onClick={() => { if (window.confirm(`Ștergi clientul „${customer.legalName}”? Facturile deja emise rămân neschimbate.`)) deleteCustomer.mutate(customer.id) }}>Șterge</button></td></tr>)}</tbody></table></div>}
      </section>
      <section className="card sticky-card"><h2>Client nou</h2><p>Completează datele folosite la emiterea facturii.</p>{createCustomer.error === null ? null : <ErrorAlert error={createCustomer.error} />}<form onSubmit={submit}><label>Denumire<input name="legalName" required /></label><label>CUI / CIF<input name="taxIdentifier" required /></label><div className="form-grid two"><label>Țară<input name="countryCode" defaultValue="RO" maxLength={2} required /></label><label>Localitate<input name="city" required /></label><label className="span-two">Stradă și număr<input name="street" required /></label><label>Județ <span className="optional">opțional</span><input name="county" /></label><label>Cod poștal <span className="optional">opțional</span><input name="postalCode" /></label></div><button className="button primary full" type="submit" disabled={createCustomer.isPending}>{createCustomer.isPending ? "Se salvează…" : "Salvează clientul"}</button></form></section>
    </div>
  </Page>
}
