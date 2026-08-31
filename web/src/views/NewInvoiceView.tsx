import { useMutation, useQuery } from "@tanstack/react-query"
import { runUiEffect } from "../api.ts"
import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { formField, type FormSubmitEvent } from "../form.ts"
import { today } from "../format.ts"
import { invoicingClient } from "../invoicing-client.ts"

export const NewInvoiceView = () => {
  const customers = useQuery({ queryKey: ["customers"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listCustomers(), signal) })
  const createDraft = useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) => runUiEffect(invoicingClient.createDraft(body)),
    onSuccess: (draft) => { window.location.hash = `#/drafts/${encodeURIComponent(draft.id)}` },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const dueDate = formField(form, "dueDate")
    createDraft.mutate({ customerId: formField(form, "customerId"), issueDate: formField(form, "issueDate"), ...(dueDate === "" ? {} : { dueDate }), currency: formField(form, "currency") })
  }
  if (customers.isPending) return <Loading />
  if (customers.error !== null) return <Page title="Factură nouă" eyebrow="Draft fiscal"><ErrorAlert error={customers.error} /></Page>
  return <Page title="Factură nouă" eyebrow="Draft fiscal">
    {customers.data.length === 0 ? <section className="card empty"><strong>Ai nevoie de un client activ.</strong><EmptyState>Adaugă clientul înainte să creezi factura.</EmptyState><a className="button primary" href="#/customers">Adaugă client</a></section> : <section className="card form-card">
      {createDraft.error === null ? null : <ErrorAlert error={createDraft.error} />}
      <form onSubmit={submit}><div className="form-grid two">
        <label className="span-two">Client<select name="customerId" required defaultValue=""><option value="" disabled>Alege clientul</option>{customers.data.map((customer) => <option key={customer.id} value={customer.id}>{customer.legalName} — {customer.taxIdentifier}</option>)}</select></label>
        <label>Data emiterii<input name="issueDate" type="date" defaultValue={today()} required /></label>
        <label>Data scadenței <span className="optional">opțional</span><input name="dueDate" type="date" /></label>
        <label>Moneda<input name="currency" defaultValue="RON" maxLength={3} required /></label>
      </div><div className="form-actions"><a className="button ghost" href="#/invoices">Renunță</a><button className="button primary" type="submit" disabled={createDraft.isPending}>{createDraft.isPending ? "Se creează…" : "Creează draftul"}</button></div></form>
    </section>}
  </Page>
}
