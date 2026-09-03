import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { runUiEffect } from "../api.ts"
import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { BuyerEditor } from "../components/BuyerEditor.tsx"
import { InvoiceLinesEditor } from "../components/InvoiceLinesEditor.tsx"
import { InvoiceTotals } from "../components/InvoiceTotals.tsx"
import { Page } from "../components/Page.tsx"
import { SellerSummary } from "../components/SellerSummary.tsx"
import { today } from "../format.ts"
import {
  createDraftPayload, draftLinePayload, draftLinesForEditing, formFromDraft, headerMatchesDraft, initialBuyerSelection, linesMatchDraft, pendingLineOperations, updateDraftPayload,
  type EditableInvoiceLine, type InvoiceAuthoringForm,
} from "../invoice-authoring-state.ts"
import { invoicingClient } from "../invoicing-client.ts"
import { invoiceDocumentSeries, type Customer, type DraftInvoice, type Issuer } from "../models.ts"
import { navigate } from "../navigation.ts"
import { hasStaleDraftTax } from "../vat-defaults.ts"

interface InvoiceAuthoringViewProps {
  readonly id?: string
  readonly notify: (message: string) => void
}

const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const newForm = (issuer: Issuer, series: string, hasSavedCustomers: boolean): InvoiceAuthoringForm => {
  const issueDate = today()
  return {
    ...initialBuyerSelection(hasSavedCustomers), partyType: "company",
    legalName: "", companyTaxIdentifier: "", individualTaxIdentifier: "", countryCode: "RO", city: "", street: "", county: "", postalCode: "",
    series, issueDate, dueDate: addDays(issueDate, issuer.defaultPaymentTermDays),
  }
}

const newLine = (taxCode: string): EditableInvoiceLine => ({
  key: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "", taxCode,
})

interface AuthoringSessionProps {
  readonly initialDraft?: DraftInvoice
  readonly issuer: Issuer
  readonly customers: ReadonlyArray<Customer>
  readonly invoiceSeries: ReadonlyArray<string>
  readonly backgroundErrors: ReadonlyArray<Error>
  readonly notify: (message: string) => void
}

interface SaveRequest {
  readonly draft: DraftInvoice | undefined
  readonly form: InvoiceAuthoringForm
  readonly lines: ReadonlyArray<EditableInvoiceLine>
}

interface SaveResult {
  readonly draft: DraftInvoice
  readonly lines: ReadonlyArray<EditableInvoiceLine>
}

const AuthoringSession = ({ initialDraft, issuer, customers, invoiceSeries, backgroundErrors, notify }: AuthoringSessionProps) => {
  const queryClient = useQueryClient()
  const defaultTaxCode = (issueDate: string): string => issuer.taxConfigurations.find((tax) => tax.effectiveFrom <= issueDate && (tax.effectiveTo === undefined || issueDate <= tax.effectiveTo))?.code ?? ""
  const [draft, setDraft] = useState(initialDraft)
  const [form, setForm] = useState<InvoiceAuthoringForm>(() => initialDraft === undefined ? newForm(issuer, invoiceSeries[0] ?? "", customers.length > 0) : formFromDraft(initialDraft))
  const [lines, setLines] = useState<ReadonlyArray<EditableInvoiceLine>>(() => initialDraft === undefined ? [newLine(defaultTaxCode(today()))] : draftLinesForEditing(initialDraft))

  const recordServerDraft = (updated: DraftInvoice): void => {
    setDraft(updated)
    queryClient.setQueryData(["draft", updated.id], updated)
  }
  const save = useMutation({
    mutationFn: async (request: SaveRequest): Promise<SaveResult> => {
      let workingDraft = request.draft
      let workingLines = request.lines
      if (workingDraft === undefined) {
        workingDraft = await runUiEffect(invoicingClient.createDraft(createDraftPayload(request.form)))
        recordServerDraft(workingDraft)
      } else if (!headerMatchesDraft(request.form, workingDraft)) {
        workingDraft = await runUiEffect(invoicingClient.updateDraft(workingDraft.id, updateDraftPayload(request.form)))
        recordServerDraft(workingDraft)
      }
      let currentDraft: DraftInvoice = workingDraft
      const operations = pendingLineOperations(workingLines, currentDraft)
      for (const operation of operations) {
        const previousIds = new Set(currentDraft.lines.map((line) => line.id))
        const updated: DraftInvoice = operation.kind === "create"
          ? await runUiEffect(invoicingClient.addDraftLine(currentDraft.id, draftLinePayload(operation.line)))
          : await runUiEffect(invoicingClient.updateDraftLine(currentDraft.id, operation.lineId, draftLinePayload(operation.line)))
        const persisted = operation.kind === "create"
          ? updated.lines.find((line) => !previousIds.has(line.id))
          : updated.lines.find((line) => line.id === operation.lineId)
        if (persisted === undefined) throw new Error("Serverul nu a returnat linia salvată.")
        const editable = draftLinesForEditing({ ...updated, lines: [persisted] })[0]
        if (editable === undefined) throw new Error("Linia salvată nu a putut fi actualizată local.")
        currentDraft = updated
        workingLines = workingLines.map((line) => line.key === operation.line.key ? editable : line)
        recordServerDraft(currentDraft)
        setLines(workingLines)
      }
      return { draft: currentDraft, lines: workingLines }
    },
    onSuccess: (result) => {
      recordServerDraft(result.draft)
      setLines(result.lines)
      if (initialDraft === undefined) {
        navigate(`/drafts/${encodeURIComponent(result.draft.id)}`, { replace: true })
      }
      notify("Toate modificările draftului au fost salvate.")
    },
    onSettled: async () => { await queryClient.invalidateQueries({ queryKey: ["drafts"] }) },
  })
  const removeLine = useMutation({
    mutationFn: (line: EditableInvoiceLine) => {
      if (draft === undefined || line.lineId === undefined) return Promise.reject(new Error("Linia nu este salvată."))
      return runUiEffect(invoicingClient.deleteDraftLine(draft.id, line.lineId))
    },
    onSuccess: async (updated, input) => { recordServerDraft(updated); setLines((current) => current.filter((line) => line.key !== input.key)); await queryClient.invalidateQueries({ queryKey: ["drafts"] }); notify("Linia a fost ștearsă.") },
  })
  const removeDraft = useMutation({
    mutationFn: () => draft === undefined ? Promise.reject(new Error("Draftul nu este salvat.")) : runUiEffect(invoicingClient.deleteDraft(draft.id)),
    onSuccess: async () => {
      navigate("/invoices")
      if (draft !== undefined) window.setTimeout(() => { queryClient.removeQueries({ queryKey: ["draft", draft.id], exact: true }) }, 0)
      await queryClient.invalidateQueries({ queryKey: ["drafts"] })
      notify("Draftul a fost șters.")
    },
  })
  const issue = useMutation({
    mutationFn: () => draft === undefined ? Promise.reject(new Error("Draftul nu este salvat.")) : runUiEffect(invoicingClient.issueDraft(draft.id)),
    onSuccess: async (invoice) => {
      navigate(`/invoices/${encodeURIComponent(invoice.id)}`)
      if (draft !== undefined) window.setTimeout(() => { queryClient.removeQueries({ queryKey: ["draft", draft.id], exact: true }) }, 0)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["invoices"] }), queryClient.invalidateQueries({ queryKey: ["drafts"] })])
    },
  })
  const pending = save.isPending || removeLine.isPending || removeDraft.isPending || issue.isPending
  const unsavedLines = draft === undefined || !linesMatchDraft(lines, draft)
  const headerSaved = draft !== undefined && headerMatchesDraft(form, draft)
  const canIssue = draft !== undefined && headerSaved && draft.lines.length > 0 && !unsavedLines && !pending
  const staleTax = draft === undefined ? false : hasStaleDraftTax(draft.issueDate, draft.lines, issuer.taxConfigurations)
  const mutationError = save.error ?? removeLine.error ?? removeDraft.error ?? issue.error

  const submit = (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>): void => {
    event.preventDefault()
    save.mutate({ draft, form, lines })
  }
  const changeLine = (key: string, patch: Partial<EditableInvoiceLine>): void => { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)) }
  const deleteLine = (line: EditableInvoiceLine): void => {
    if (line.lineId === undefined) { setLines((current) => current.filter((item) => item.key !== line.key)); return }
    if (window.confirm(`Ștergi linia „${line.description}” din draft?`)) removeLine.mutate(line)
  }
  return <Page title={draft === undefined ? "Factură nouă" : `Draft ${draft.series}`} eyebrow="Document de lucru" actions={<a className="button ghost" href="/invoices">Înapoi la facturi</a>}>
    {backgroundErrors.map((error, index) => <ErrorAlert key={`${error.message}-${String(index)}`} error={error} />)}
    {mutationError === null ? null : <ErrorAlert error={mutationError} />}
    {initialDraft === undefined && draft !== undefined && save.error !== null ? <p className="status-note warning" role="status">Draftul a fost creat și păstrat în această pagină. Corectează eroarea și apasă din nou „Salvează draftul”; vor fi retrimise numai liniile rămase sau modificate.</p> : null}
    {staleTax ? <p className="status-note warning" role="status" aria-live="polite">Configurația TVA s-a schimbat. Salvează antetul sau liniile afectate și verifică totalurile înainte de emitere.</p> : null}
    <form className="authoring-form" onSubmit={submit}>
      <div className="authoring-main">
        <SellerSummary issuer={issuer} />
        <BuyerEditor form={form} customers={customers} disabled={pending} onChange={(patch) => { setForm((current) => ({ ...current, ...patch })) }} />
        <section className="card authoring-section"><div className="section-heading"><div><h2>3. Date document</h2><p>Seria se fixează la crearea draftului. Moneda este RON.</p></div></div><div className="form-grid four"><label>Serie factură<select required disabled={pending || draft !== undefined} value={form.series} onChange={(event) => { setForm((current) => ({ ...current, series: event.currentTarget.value })) }}>{invoiceSeries.map((series) => <option key={series} value={series}>{series}</option>)}</select></label><label>Data emiterii<input required disabled={pending} type="date" value={form.issueDate} onChange={(event) => { setForm((current) => ({ ...current, issueDate: event.currentTarget.value })) }} /></label><label>Data scadenței<input required disabled={pending} type="date" min={form.issueDate} value={form.dueDate} onChange={(event) => { setForm((current) => ({ ...current, dueDate: event.currentTarget.value })) }} /></label><div className="static-field"><span>Monedă</span><span className="fixed-value">RON</span></div></div></section>
        <InvoiceLinesEditor lines={lines} taxConfigurations={issuer.taxConfigurations} issueDate={form.issueDate} pending={pending} onAdd={() => { setLines((current) => [...current, newLine(defaultTaxCode(form.issueDate))]) }} onChange={changeLine} onDelete={deleteLine} />
      </div>
      <div className="authoring-side"><InvoiceTotals draft={draft} /><section className="card draft-actions"><h2>Acțiuni draft</h2><button className="button secondary wide" type="submit" disabled={pending}>{save.isPending ? "Se salvează toate modificările…" : "Salvează draftul"}</button><p className="hint">Salvarea validează și persistă cumpărătorul, antetul și toate liniile noi sau modificate. O linie suplimentară goală blochează salvarea până este completată sau ștearsă.</p><button className="button primary wide" type="button" disabled={!canIssue} onClick={() => { if (window.confirm(staleTax ? "Configurația TVA s-a schimbat. Emiți factura cu totalurile afișate de server? Documentul fiscal devine imuabil." : "Emiți factura? Numărul și documentul fiscal devin imuabile.")) issue.mutate() }}>{issue.isPending ? "Se emite…" : "Emite factura"}</button>{draft === undefined ? null : <button className="button danger ghost wide" type="button" disabled={pending} onClick={() => { if (window.confirm("Ștergi definitiv acest draft?")) removeDraft.mutate() }}>Șterge draftul</button>}<p className="hint">Emiterea cere antet salvat, cel puțin o linie salvată și nicio modificare în curs.</p></section></div>
    </form>
  </Page>
}

export const InvoiceAuthoringView = ({ id, notify }: InvoiceAuthoringViewProps) => {
  const customers = useQuery({ queryKey: ["customers"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listCustomers(), signal) })
  const issuer = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const series = useQuery({ queryKey: ["document-series"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listDocumentSeries(), signal) })
  const draft = useQuery({ queryKey: ["draft", id], enabled: id !== undefined, queryFn: ({ signal }) => id === undefined ? Promise.reject(new Error("Lipsește identificatorul draftului.")) : runUiEffect(invoicingClient.getDraft(id), signal) })
  const requiredPending = (issuer.data === undefined && issuer.isPending)
    || (series.data === undefined && series.isPending)
    || (id !== undefined && draft.data === undefined && draft.isPending)
    || (id === undefined && customers.data === undefined && customers.isPending)
  if (requiredPending) return <Loading />
  const blockingError = issuer.data === undefined
    ? issuer.error
    : series.data === undefined
      ? series.error
      : id !== undefined && draft.data === undefined
        ? draft.error
        : null
  if (blockingError !== null) return <Page title="Editare factură" eyebrow="Document de lucru"><ErrorAlert error={blockingError} /></Page>
  if (issuer.data === null || issuer.data === undefined) return <Page title="Factură nouă" eyebrow="Configurare necesară"><section className="card empty"><strong>Configurează mai întâi furnizorul.</strong><a className="button primary" href="/settings">Deschide setările</a></section></Page>
  const invoiceSeries = invoiceDocumentSeries(series.data ?? []).map((item) => item.series)
  if (invoiceSeries.length === 0) return <Page title="Factură nouă" eyebrow="Configurare necesară"><section className="card empty"><strong>Configurează o serie de factură.</strong><a className="button primary" href="/settings">Deschide setările</a></section></Page>
  if (id !== undefined && draft.data === undefined) return <Page title="Draft indisponibil" eyebrow="Document de lucru"><EmptyState>Draftul nu a putut fi încărcat.</EmptyState></Page>
  const backgroundErrors = [customers.error, issuer.error, series.error, draft.error].filter((error): error is Error => error !== null)
  return <AuthoringSession key={draft.data?.id ?? "new"} {...(draft.data === undefined ? {} : { initialDraft: draft.data })} issuer={issuer.data} customers={customers.data ?? []} invoiceSeries={invoiceSeries} backgroundErrors={backgroundErrors} notify={notify} />
}
