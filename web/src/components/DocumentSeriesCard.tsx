import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { runUiEffect } from "../api.ts"
import { formField, type FormSubmitEvent } from "../form.ts"
import { invoicingClient, type DocumentSeries } from "../invoicing-client.ts"
import type { DocumentType } from "../models.ts"
import { EmptyState, ErrorAlert, Loading } from "./AsyncState.tsx"
import { Button } from "./ui/Button.tsx"

const documentTypeLabels: Readonly<Record<DocumentType, string>> = {
  invoice: "Factură",
  proforma: "Proformă",
}

export const DocumentSeriesCard = ({ notify }: { readonly notify: (message: string) => void }) => {
  const queryClient = useQueryClient()
  const seriesQuery = useQuery({
    queryKey: ["document-series"],
    queryFn: ({ signal }) => runUiEffect(invoicingClient.listDocumentSeries(), signal),
  })
  const addSeries = useMutation({
    mutationFn: (body: { readonly documentType: DocumentType; readonly series: string }) => runUiEffect(invoicingClient.createDocumentSeries(body)),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["document-series"] })
      notify(`Seria ${created.series} pentru ${documentTypeLabels[created.documentType].toLocaleLowerCase("ro-RO")} a fost adăugată.`)
    },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const documentType = formField(form, "documentType")
    if (documentType !== "invoice" && documentType !== "proforma") return
    addSeries.mutate({ documentType, series: formField(form, "series") }, { onSuccess: () => { form.reset() } })
  }

  return <section className="card form-card" aria-labelledby="document-series-title">
    <div className="section-heading"><div><h2 id="document-series-title">Serii de documente</h2><p>Adaugă separat seriile permise pentru facturi și proforme. Seriile adăugate rămân disponibile și nu pot fi editate aici.</p></div></div>
    {seriesQuery.isPending ? <Loading label="Se încarcă seriile…" /> : seriesQuery.error !== null ? <ErrorAlert error={seriesQuery.error} /> : <SeriesList series={seriesQuery.data} />}
    {addSeries.error === null ? null : <ErrorAlert error={addSeries.error} />}
    <form className="document-series-form" onSubmit={submit}>
      <div className="form-grid two document-series-inputs">
        <label>Tip document<select name="documentType" defaultValue="invoice" required><option value="invoice">Factură</option><option value="proforma">Proformă</option></select></label>
        <label>Serie<input name="series" maxLength={20} pattern="[A-Z0-9][A-Z0-9_\-]{0,19}" title="1–20 caractere: litere mari, cifre, underscore sau cratimă" autoCapitalize="characters" aria-describedby="document-series-hint" onInput={(event) => { event.currentTarget.value = event.currentTarget.value.toUpperCase() }} required /></label>
      </div>
      <p className="hint" id="document-series-hint">Folosește 1–20 de caractere: litere mari, cifre, „_” sau „-”. Operația este doar de adăugare.</p>
      <div className="form-actions"><Button variant="secondary" type="submit" disabled={addSeries.isPending}>{addSeries.isPending ? "Se adaugă…" : "Adaugă seria"}</Button></div>
    </form>
  </section>
}

const SeriesList = ({ series }: { readonly series: ReadonlyArray<DocumentSeries> }) => series.length === 0
  ? <EmptyState>Nu există încă serii configurate. Adaugă cel puțin o serie de factură pentru a putea crea drafturi.</EmptyState>
  : <div className="table-wrap"><table><caption className="sr-only">Seriile de documente configurate</caption><thead><tr><th>Tip document</th><th>Serie</th></tr></thead><tbody>{series.map((item) => <tr key={`${item.documentType}:${item.series}`}><td>{documentTypeLabels[item.documentType]}</td><td><strong>{item.series}</strong></td></tr>)}</tbody></table></div>
