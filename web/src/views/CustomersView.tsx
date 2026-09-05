import { useEffect, useRef } from "react"

import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { useCustomerRegistry } from "../customer-registry-hooks.ts"
import { focusAndReveal } from "../focus.ts"
import { identifierLabel } from "../invoice-authoring-state.ts"
import { normalizeRomanianCui, romanianCuiPattern } from "../vat-defaults.ts"

export const CustomersView = ({ notify }: { readonly notify: (message: string) => void }) => {
  const state = useCustomerRegistry(notify)
  const editHeading = useRef<HTMLHeadingElement>(null)
  const editing = state.editing
  useEffect(() => {
    if (editing === undefined) return
    focusAndReveal(editHeading.current)
  }, [editing])
  const customers = state.customers.data
  if (customers === undefined) return state.customers.error === null
    ? <Loading />
    : <Page title="Clienți" eyebrow="Registru"><ErrorAlert error={state.customers.error} /></Page>
  const items = customers
  return <Page title="Clienți" eyebrow="Registru activ" actions={<ButtonLink href="/invoices/new">Factură nouă</ButtonLink>}>
    <div className="split-layout">
      <section className="card overview-section">
        <div className="section-heading"><div><h2>Registru clienți</h2><p>Clienții salvați precompletează datele și termenul de plată al unei facturi noi.</p></div><span className="count">{items.length}</span></div>
        {state.removal.error === null ? null : <ErrorAlert error={state.removal.error} />}
        {items.length === 0 ? <EmptyState>Nu există încă niciun client activ. Poți emite facturi și pentru clienți ocazionali.</EmptyState> : <div className="table-wrap"><table><thead><tr><th>Client</th><th>Identificator</th><th>Adresă</th><th>Termen</th><th><span className="sr-only">Acțiuni</span></th></tr></thead><tbody>{items.map((customer) => <tr key={customer.id}><td data-label="Client"><strong>{customer.name}</strong><small>{customer.partyType === "company" ? "PJ" : "PF"}</small></td><td data-label="Identificator">{identifierLabel(customer.partyType)}: {customer.fiscalIdentifier === "" ? "—" : customer.fiscalIdentifier}</td><td data-label="Adresă">{customer.address.street}, {customer.address.city}</td><td data-label="Termen">{customer.defaultPaymentTermDays === undefined ? "Implicit firmă" : `${String(customer.defaultPaymentTermDays)} zile`}</td><td data-label="Acțiuni" className="row-actions"><div className="table-actions"><Button variant="ghost" size="small" disabled={state.save.isPending || state.removal.isPending} onClick={() => { state.edit(customer) }}>Editează</Button><Button variant="danger" size="small" disabled={state.removal.isPending} onClick={() => { state.remove(customer) }}>Șterge</Button></div></td></tr>)}</tbody></table></div>}
      </section>
      <section className="card sticky-card"><h2 ref={editHeading} tabIndex={-1} aria-live="polite">{editing === undefined ? "Client nou" : "Editează clientul"}</h2><p>Termenul de plată este opțional; dacă lipsește, se folosește valoarea din setările firmei.</p>{state.save.error === null ? null : <ErrorAlert error={state.save.error} />}<form key={editing?.id ?? "new"} onSubmit={state.submit}>
        <fieldset className="segmented-fieldset"><legend>Tip persoană</legend><div className="segmented-control compact-segments"><label><input type="radio" name="partyType" value="company" checked={state.partyType === "company"} onChange={() => { state.setPartyType("company") }} /><span>PJ</span></label><label><input type="radio" name="partyType" value="individual" checked={state.partyType === "individual"} onChange={() => { state.setPartyType("individual") }} /><span>PF</span></label></div></fieldset>
        <label>{state.partyType === "company" ? "Denumire" : "Nume complet"}<input name="name" required defaultValue={editing?.name ?? ""} /></label>
        <label>{identifierLabel(state.partyType)} {state.partyType === "individual" ? <span className="optional">opțional</span> : null}<input name="fiscalIdentifier" defaultValue={editing?.fiscalIdentifier ?? ""} pattern={state.partyType === "company" ? romanianCuiPattern : "(?:[0-9]{13})?"} maxLength={13} title={state.partyType === "company" ? "CUI românesc valid, cu sau fără prefixul RO" : "CNP valid din 13 cifre sau câmp gol"} inputMode={state.partyType === "individual" ? "numeric" : "text"} onInput={(event) => { event.currentTarget.value = state.partyType === "company" ? normalizeRomanianCui(event.currentTarget.value) : event.currentTarget.value.replace(/\D/g, "") }} aria-describedby="customer-identifier-hint" /></label>
        <p className="hint left" id="customer-identifier-hint">{state.partyType === "company" ? "CUI românesc cu sau fără prefixul RO." : "CNP-ul este opțional și nu va fi completat artificial."}</p>
        <div className="form-grid two"><label>Țară<select value="RO" disabled><option value="RO">România (RO)</option></select></label><label>Localitate<input name="city" required defaultValue={editing?.address.city ?? ""} /></label><label className="span-two">Stradă și număr<input name="street" required defaultValue={editing?.address.street ?? ""} /></label><label>Județ <span className="optional">opțional</span><input name="county" defaultValue={editing?.address.county ?? ""} /></label><label>Cod poștal <span className="optional">opțional</span><input name="postalCode" defaultValue={editing?.address.postalCode ?? ""} /></label></div>
        <label>Termen de plată <span className="optional">opțional, în zile</span><input name="defaultPaymentTermDays" type="number" min="0" max="3650" step="1" inputMode="numeric" defaultValue={editing?.defaultPaymentTermDays ?? ""} placeholder="Implicit firmă" /></label>
        <div className="form-actions">{editing === undefined ? null : <Button variant="ghost" disabled={state.save.isPending} onClick={state.cancelEdit}>Renunță</Button>}<Button type="submit" disabled={state.save.isPending}>{state.save.isPending ? "Se salvează…" : editing === undefined ? "Adaugă client" : "Salvează modificările"}</Button></div>
      </form></section>
    </div>
  </Page>
}
