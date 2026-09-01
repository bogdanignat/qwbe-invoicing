import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { runUiEffect } from "../api.ts"
import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { Page } from "../components/Page.tsx"
import { formField, type FormSubmitEvent } from "../form.ts"
import { money } from "../format.ts"
import { invoicingClient } from "../invoicing-client.ts"
import { hasStaleDraftTax } from "../vat-defaults.ts"

export const DraftView = ({ id, notify }: { readonly id: string; readonly notify: (message: string) => void }) => {
  const queryClient = useQueryClient()
  const draft = useQuery({ queryKey: ["draft", id], queryFn: ({ signal }) => runUiEffect(invoicingClient.getDraft(id), signal) })
  const issuer = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const addLine = useMutation({
    mutationFn: (body: Readonly<Record<string, unknown>>) => runUiEffect(invoicingClient.addDraftLine(id, body)),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["draft", id] }); notify("Linia a fost adăugată.") },
  })
  const issue = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.issueDraft(id)),
    onSuccess: async (invoice) => { await queryClient.invalidateQueries({ queryKey: ["invoices"] }); window.location.hash = `#/invoices/${encodeURIComponent(invoice.id)}` },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    addLine.mutate({ description: formField(form, "description"), quantity: formField(form, "quantity"), unitPrice: formField(form, "unitPrice"), taxCode: formField(form, "taxCode") }, { onSuccess: () => { form.reset() } })
  }
  if (draft.isPending || issuer.isPending) return <Loading />
  if (draft.error !== null) return <Page title="Draft factură" eyebrow="Document de lucru"><ErrorAlert error={draft.error} /></Page>
  if (issuer.error !== null) return <Page title="Draft factură" eyebrow="Document de lucru"><ErrorAlert error={issuer.error} /></Page>
  const taxConfigurations = issuer.data?.taxConfigurations ?? []
  const defaultTaxCode = taxConfigurations.find((configuration) =>
    configuration.effectiveFrom <= draft.data.issueDate
    && (configuration.effectiveTo === undefined || draft.data.issueDate <= configuration.effectiveTo))?.code ?? ""
  const hasOutdatedTax = hasStaleDraftTax(draft.data.issueDate, draft.data.lines, taxConfigurations)
  return <Page title="Draft factură" eyebrow={`Scadență ${draft.data.dueDate}`}>
    <div className="split-layout invoice-layout">
      <section className="card">
        <div className="section-heading"><div><h2>Linii factură</h2><p>Calculele de TVA și totalurile sunt făcute exclusiv de server.</p></div><span className="badge muted">{draft.data.status}</span></div>
        {addLine.error === null ? null : <ErrorAlert error={addLine.error} />}
        {hasOutdatedTax ? <p className="status-note warning">Configurația TVA a firmei s-a schimbat după adăugarea liniilor. Verifică valorile înainte de emitere.</p> : null}
        {draft.data.lines.length === 0 ? <EmptyState>Draftul nu are încă linii.</EmptyState> : <div className="table-wrap"><table><caption className="sr-only">Liniile draftului</caption><thead><tr><th>Descriere</th><th>Cant.</th><th>Preț</th><th>TVA</th><th>Total</th></tr></thead><tbody>{draft.data.lines.map((line) => <tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{money(line.unitPrice, draft.data.currency)}</td><td>{line.taxRate}%</td><td>{money(line.totalIncludingTax, draft.data.currency)}</td></tr>)}</tbody></table></div>}
        <form className="inline-form" onSubmit={submit}><label>Descriere<input name="description" required /></label><label>Cantitate<input name="quantity" inputMode="decimal" defaultValue="1" required /></label><label>Preț unitar<input name="unitPrice" inputMode="decimal" required /></label><label>Cod TVA<input name="taxCode" defaultValue={defaultTaxCode} required /></label><button className="button secondary" type="submit" disabled={addLine.isPending}>{addLine.isPending ? "Se adaugă…" : "Adaugă linia"}</button></form>
      </section>
      <aside className="card sticky-card summary-card"><h2>Sumar draft</h2>{issue.error === null ? null : <ErrorAlert error={issue.error} />}<dl><div><dt>Serie fixată</dt><dd>{draft.data.series}</dd></div><div><dt>Data emiterii</dt><dd>{draft.data.issueDate}</dd></div><div><dt>Scadență</dt><dd>{draft.data.dueDate}</dd></div><div><dt>Monedă</dt><dd>{draft.data.currency}</dd></div><div><dt>Linii</dt><dd>{draft.data.lines.length}</dd></div></dl><button className="button primary wide" type="button" onClick={() => { if (window.confirm(hasOutdatedTax ? "Configurația TVA s-a schimbat după adăugarea liniilor. Emiți factura cu valorile TVA existente în draft?" : "Emiți factura? Numărul și snapshot-ul fiscal devin imuabile.")) issue.mutate() }} disabled={draft.data.lines.length === 0 || issue.isPending}>{issue.isPending ? "Se emite…" : "Emite factura"}</button><p className="hint">Seria este fixată în draft; emiterea alocă doar numărul fiscal.</p></aside>
    </div>
  </Page>
}
