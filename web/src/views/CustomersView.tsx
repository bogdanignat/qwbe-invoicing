import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { runUiEffect } from "../api.ts"
import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { formField, type FormSubmitEvent } from "../form.ts"
import { invoicingClient } from "../invoicing-client.ts"
import { identifierLabel } from "../invoice-authoring-state.ts"
import type { PartyType } from "../models.ts"
import { normalizeRomanianCui, romanianCuiPattern } from "../vat-defaults.ts"

export const CustomersView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const queryClient = useQueryClient()
  const [partyType, setPartyType] = useState<PartyType>("company")
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
    const taxIdentifierInput = form.elements.namedItem("taxIdentifier")
    if (taxIdentifierInput instanceof HTMLInputElement) {
      const missingCompanyCui = partyType === "company" && taxIdentifierInput.value.trim() === ""
      taxIdentifierInput.setCustomValidity(missingCompanyCui ? "CUI / CIF este obligatoriu pentru persoanele juridice." : "")
      if (missingCompanyCui) { taxIdentifierInput.reportValidity(); taxIdentifierInput.setCustomValidity(""); return }
    }
    const county = formField(form, "county")
    const postalCode = formField(form, "postalCode")
    createCustomer.mutate({
      partyType, legalName: formField(form, "legalName"), taxIdentifier: formField(form, "taxIdentifier"),
      address: { countryCode: "RO", city: formField(form, "city"), street: formField(form, "street"), ...(county === "" ? {} : { county }), ...(postalCode === "" ? {} : { postalCode }) },
    }, { onSuccess: () => { form.reset() } })
  }
  if (customers.isPending) return <Loading />
  if (customers.error !== null) return <Page title="Clienți" eyebrow="Registru"><ErrorAlert error={customers.error} /></Page>
  return <Page title="Clienți" eyebrow="Registru activ" actions={<a className="button primary" href="#/invoices/new">Factură nouă</a>}>
    <div className="split-layout">
      <section className="card">
        <div className="section-heading"><div><h2>Registru clienți</h2><p>Registrul este opțional; clienții activi pot precompleta rapid un draft nou.</p></div><span className="count">{customers.data.length}</span></div>
        {deleteCustomer.error === null ? null : <ErrorAlert error={deleteCustomer.error} />}
        {customers.data.length === 0 ? <EmptyState>Nu există încă niciun client activ. Poți emite facturi și pentru clienți ocazionali, direct din factura nouă.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>Identificator</th><th>Adresă</th><th><span className="sr-only">Acțiuni</span></th></tr></thead><tbody>{customers.data.map((customer) => <tr key={customer.id}><td><strong>{customer.legalName}</strong><small>{customer.partyType === "company" ? "PJ" : "PF"}</small></td><td>{identifierLabel(customer.partyType)}: {customer.taxIdentifier === "" ? "—" : customer.taxIdentifier}</td><td>{customer.address.street}, {customer.address.city}</td><td className="align-right"><button className="button danger ghost compact" type="button" disabled={deleteCustomer.isPending} onClick={() => { if (window.confirm(`Ștergi clientul „${customer.legalName}”? Facturile deja emise rămân neschimbate.`)) deleteCustomer.mutate(customer.id) }}>Șterge</button></td></tr>)}</tbody></table></div>}
      </section>
      <section className="card sticky-card"><h2>Client nou</h2><p>Completează datele folosite la emiterea facturii.</p>{createCustomer.error === null ? null : <ErrorAlert error={createCustomer.error} />}<form onSubmit={submit}><fieldset className="segmented-fieldset"><legend>Tip persoană</legend><div className="segmented-control compact-segments"><label><input type="radio" name="partyType" value="company" checked={partyType === "company"} onChange={() => { setPartyType("company") }} /><span>PJ</span></label><label><input type="radio" name="partyType" value="individual" checked={partyType === "individual"} onChange={() => { setPartyType("individual") }} /><span>PF</span></label></div></fieldset><label>{partyType === "company" ? "Denumire" : "Nume complet"}<input name="legalName" required /></label><label>{identifierLabel(partyType)} {partyType === "individual" ? <span className="optional">opțional</span> : null}<input name="taxIdentifier" pattern={partyType === "company" ? romanianCuiPattern : "(?:[0-9]{13})?"} maxLength={13} title={partyType === "company" ? "CUI românesc valid, cu sau fără prefixul RO" : "CNP valid din 13 cifre sau câmp gol"} inputMode={partyType === "individual" ? "numeric" : "text"} onInput={(event) => { event.currentTarget.value = partyType === "company" ? normalizeRomanianCui(event.currentTarget.value) : event.currentTarget.value.replace(/\D/g, "") }} aria-describedby="customer-identifier-hint" /></label><p className="hint" id="customer-identifier-hint">{partyType === "company" ? "CUI românesc cu sau fără prefixul RO." : "CNP-ul este opțional și nu va fi completat artificial."}</p><div className="form-grid two"><label>Țară<select name="countryCode" defaultValue="RO" required><option value="RO">România (RO)</option></select></label><label>Localitate<input name="city" required /></label><label className="span-two">Stradă și număr<input name="street" required /></label><label>Județ <span className="optional">opțional</span><input name="county" /></label><label>Cod poștal <span className="optional">opțional</span><input name="postalCode" /></label></div><button className="button primary full" type="submit" disabled={createCustomer.isPending}>{createCustomer.isPending ? "Se salvează…" : "Salvează clientul"}</button></form></section>
    </div>
  </Page>
}
