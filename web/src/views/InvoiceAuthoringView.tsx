import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { runUiEffect } from "../api.ts"
import { EmptyState, ErrorAlert, Loading } from "../components/AsyncState.tsx"
import { BuyerEditor } from "../components/BuyerEditor.tsx"
import { InvoiceLinesEditor } from "../components/InvoiceLinesEditor.tsx"
import { InvoiceTotals } from "../components/InvoiceTotals.tsx"
import { Page } from "../components/Page.tsx"
import { ProformaIssueControl } from "../components/ProformaIssueControl.tsx"
import { SellerSummary } from "../components/SellerSummary.tsx"
import { Button } from "../components/ui/Button.tsx"
import { ButtonLink } from "../components/ui/ButtonLink.tsx"
import { today } from "../format.ts"
import {
  authoringAccess, authoringDocumentPayload, authoringReadiness, authoringSeriesOptions, createDraftPayload, draftLinePayload, draftLinesForEditing, formFromDraft, headerMatchesDraft, newAuthoringForm, pendingLineOperations, updateDraftPayload,
  type EditableInvoiceLine, type InvoiceAuthoringForm,
} from "../invoice-authoring-state.ts"
import { useInvoiceAuthoringCustomers } from "../invoice-authoring-customers-hooks.ts"
import { useInvoiceAuthoringPresets } from "../invoice-authoring-presets-hooks.ts"
import { invoicingClient } from "../invoicing-client.ts"
import { useInvoiceIssuance } from "../invoices-hooks.ts"
import type { Customer, DraftInvoice, Issuer, UnitOfMeasure } from "../models.ts"
import { navigate } from "../navigation.ts"
import { useProformaIssuance } from "../proforma-hooks.ts"
import { hasStaleDraftTax } from "../vat-defaults.ts"

interface InvoiceAuthoringViewProps {
  readonly id?: string
  readonly notify: (message: string) => void
}

const newLine = (vatRateCode: string, unitOfMeasure: UnitOfMeasure): EditableInvoiceLine => ({
  key: crypto.randomUUID(), description: "", quantity: "1", unitPrice: "", unitOfMeasure, vatRateCode,
})
const defaultUnitOfMeasure = (units: ReadonlyArray<UnitOfMeasure>): UnitOfMeasure =>
  units.find(({ code }) => code === "C62") ?? units[0] ?? { code: "C62", name: "unitate" }

interface AuthoringSessionProps {
  readonly initialDraft?: DraftInvoice
  readonly issuer: Issuer
  readonly customers: ReadonlyArray<Customer>
  readonly invoiceSeries: ReadonlyArray<string>
  readonly proformaSeries: ReadonlyArray<string>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
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

const AuthoringSession = ({ initialDraft, issuer, customers, invoiceSeries, proformaSeries, unitOfMeasures, backgroundErrors, notify }: AuthoringSessionProps) => {
  const queryClient = useQueryClient()
  const defaultTaxCode = (issueDate: string): string => issuer.vatConfigurations.find((tax) => tax.effectiveFrom <= issueDate && (tax.effectiveTo === undefined || issueDate <= tax.effectiveTo))?.code ?? ""
  const [draft, setDraft] = useState(initialDraft)
  const [form, setForm] = useState<InvoiceAuthoringForm>(() => initialDraft === undefined ? newAuthoringForm(issuer, invoiceSeries[0] ?? "", customers.length > 0, today()) : formFromDraft(initialDraft))
  const [lines, setLines] = useState<ReadonlyArray<EditableInvoiceLine>>(() => initialDraft === undefined
    ? [newLine(defaultTaxCode(today()), defaultUnitOfMeasure(unitOfMeasures))]
    : draftLinesForEditing(initialDraft))
  const authoringCustomers = useInvoiceAuthoringCustomers({ customers, issuer, deriveDueDate: draft === undefined, setForm })
  const authoringPresets = useInvoiceAuthoringPresets({ setLines })

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
  const workflowPending = save.isPending || removeLine.isPending || removeDraft.isPending
  const readiness = authoringReadiness(form, lines, draft, workflowPending)
  const payload = authoringDocumentPayload(form, lines)
  const staleTax = draft === undefined ? false : hasStaleDraftTax(draft.issueDate, draft.lines, issuer.vatConfigurations)
  const invoiceIssuance = useInvoiceIssuance({ draftId: draft?.id, payload, canIssue: readiness.canIssue,
    workflowPending, confirmMessage: staleTax ? "Configurația TVA s-a schimbat. Emiți factura cu totalurile afișate de server? Documentul fiscal devine imuabil." : "Emiți factura? Numărul și documentul fiscal devin imuabile." })
  const proformaIssuance = useProformaIssuance({ draftId: draft?.id, payload, editable: readiness.editable,
    series: proformaSeries, synchronized: readiness.synchronized, hasLines: readiness.hasLines,
    workflowPending: workflowPending || invoiceIssuance.pending })
  const pending = workflowPending || invoiceIssuance.pending || proformaIssuance.pending
  const canIssue = invoiceIssuance.canIssue && !proformaIssuance.pending
  const mutationError = save.error ?? removeLine.error ?? removeDraft.error ?? invoiceIssuance.error

  const submit = (event: React.SyntheticEvent<HTMLFormElement, SubmitEvent>): void => {
    event.preventDefault()
    save.mutate({ draft, form, lines })
  }
  const changeLine = (key: string, patch: Partial<EditableInvoiceLine>): void => { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)) }
  const deleteLine = (line: EditableInvoiceLine): void => {
    if (line.lineId === undefined) { setLines((current) => current.filter((item) => item.key !== line.key)); return }
    if (window.confirm(`Ștergi linia „${line.description}” din draft?`)) removeLine.mutate(line)
  }
  return <Page title={draft === undefined ? "Document nou" : `Draft ${draft.series}`} eyebrow="Document de lucru" actions={<ButtonLink variant="ghost" href="/invoices">Înapoi la documente</ButtonLink>}>
    {[...backgroundErrors, authoringPresets.error].filter((error): error is Error => error !== null).map((error, index) => <ErrorAlert key={`${error.message}-${String(index)}`} error={error} />)}
    {mutationError === null ? null : <ErrorAlert error={mutationError} />}
    {initialDraft === undefined && draft !== undefined && save.error !== null ? <p className="status-note warning" role="status">Draftul a fost creat și păstrat în această pagină. Corectează eroarea și apasă din nou „Salvează draftul”; vor fi retrimise numai liniile rămase sau modificate.</p> : null}
    {staleTax ? <p className="status-note warning" role="status" aria-live="polite">Configurația TVA s-a schimbat. Salvează antetul sau liniile afectate și verifică totalurile înainte de emitere.</p> : null}
    <form className="authoring-form" onSubmit={submit}>
      <div className="authoring-main">
        <SellerSummary issuer={issuer} />
        <BuyerEditor form={form} customers={customers} disabled={pending} onChange={(patch) => { setForm((current) => ({ ...current, ...patch })) }} onBuyerModeChange={authoringCustomers.chooseBuyerMode} onSavedCustomerChange={authoringCustomers.chooseCustomer} />
        <section className="card authoring-section"><div className="section-heading"><div><h2>3. Date document</h2><p>Alege seria facturii; poți salva un draft sau emite direct. Moneda este RON.</p></div></div><div className="form-grid four"><label>Serie factură<select required disabled={pending || draft !== undefined} value={form.series} onChange={(event) => { const { value } = event.currentTarget; setForm((current) => ({ ...current, series: value })) }}>{invoiceSeries.map((series) => <option key={series} value={series}>{series}</option>)}</select></label><label>Data emiterii<input required disabled={pending} type="date" value={form.issueDate} onChange={(event) => { authoringCustomers.chooseIssueDate(event.currentTarget.value) }} /></label><label>Data scadenței <span className="optional">opțională</span><input disabled={pending} type="date" min={form.issueDate} value={form.dueDate} onChange={(event) => { authoringCustomers.chooseDueDate(event.currentTarget.value) }} /></label><div className="static-field"><span>Monedă</span><span className="fixed-value">RON</span></div></div></section>
        <InvoiceLinesEditor lines={lines} productPresets={authoringPresets.presets} vatConfigurations={issuer.vatConfigurations} unitOfMeasures={unitOfMeasures} issueDate={form.issueDate} pending={pending} onAdd={() => { setLines((current) => [...current, newLine(defaultTaxCode(form.issueDate), defaultUnitOfMeasure(unitOfMeasures))]) }} onChange={changeLine} onApplyPreset={authoringPresets.choosePreset} onDelete={deleteLine} />
      </div>
      <div className="authoring-side"><InvoiceTotals draft={draft} /><section className="card draft-actions"><h2>Acțiuni document</h2><Button variant="secondary" fullWidth type="submit" disabled={pending}>{save.isPending ? "Se salvează toate modificările…" : "Salvează draftul"}</Button><p className="hint">Draftul este opțional și rămâne editabil.</p><ProformaIssueControl state={proformaIssuance} /><h3>Emitere factură</h3><Button fullWidth disabled={!canIssue} onClick={(event) => { if (event.currentTarget.form?.reportValidity() !== false) invoiceIssuance.issue() }}>{invoiceIssuance.pending ? "Se emite…" : "Emite factura"}</Button>{draft === undefined ? null : <Button variant="danger" fullWidth disabled={pending} onClick={() => { if (window.confirm("Ștergi definitiv acest draft?")) removeDraft.mutate() }}>Șterge draftul</Button>}<p className="hint">Dintr-un document nou poți emite direct. Dacă ai salvat deja draftul, salvează întâi orice modificare nouă.</p></section></div>
    </form>
  </Page>
}

export const InvoiceAuthoringView = ({ id, notify }: InvoiceAuthoringViewProps) => {
  const customers = useQuery({ queryKey: ["customers"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listCustomers(), signal) })
  const issuer = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const series = useQuery({ queryKey: ["document-series"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listDocumentSeries(), signal) })
  const unitOfMeasures = useQuery({ queryKey: ["unit-of-measures"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listUnitOfMeasures(), signal) })
  const draft = useQuery({ queryKey: ["draft", id], enabled: id !== undefined, queryFn: ({ signal }) => id === undefined ? Promise.reject(new Error("Lipsește identificatorul draftului.")) : runUiEffect(invoicingClient.getDraft(id), signal) })
  if (id !== undefined && draft.data === undefined && draft.isPending) return <Loading />
  const loadedDraft = draft.data
  const access = loadedDraft === undefined ? undefined : authoringAccess(loadedDraft.status)
  if (loadedDraft !== undefined && access !== undefined && !access.editable) return <Page title={`Draft ${loadedDraft.series}`} eyebrow="Document blocat" actions={<ButtonLink variant="ghost" href={access.registryHref}>Înapoi la registru</ButtonLink>}>
    <section className="card empty" role="status"><strong>Draft blocat</strong><p>{access.notice}</p><ButtonLink href={access.registryHref}>{access.registryLabel}</ButtonLink></section>
  </Page>
  const requiredPending = (issuer.data === undefined && issuer.isPending)
    || (series.data === undefined && series.isPending)
    || (unitOfMeasures.data === undefined && unitOfMeasures.isPending)
    || (id === undefined && customers.data === undefined && customers.isPending)
  if (requiredPending) return <Loading />
  const blockingError = issuer.data === undefined
    ? issuer.error
    : series.data === undefined
      ? series.error
      : unitOfMeasures.data === undefined
        ? unitOfMeasures.error
        : id !== undefined && draft.data === undefined
          ? draft.error
          : null
  if (blockingError !== null) return <Page title="Editare factură" eyebrow="Document de lucru"><ErrorAlert error={blockingError} /></Page>
  if (issuer.data === null || issuer.data === undefined) return <Page title="Factură nouă" eyebrow="Configurare necesară"><section className="card empty"><strong>Configurează mai întâi furnizorul.</strong><ButtonLink href="/settings">Deschide setările</ButtonLink></section></Page>
  const seriesOptions = authoringSeriesOptions(series.data ?? [])
  const invoiceSeries = seriesOptions.invoice
  const proformaSeries = seriesOptions.proforma
  if (invoiceSeries.length === 0) return <Page title="Factură nouă" eyebrow="Configurare necesară"><section className="card empty"><strong>Configurează o serie de factură.</strong><ButtonLink href="/settings">Deschide setările</ButtonLink></section></Page>
  if ((unitOfMeasures.data ?? []).length === 0) return <Page title="Factură nouă" eyebrow="Catalog indisponibil"><EmptyState>Catalogul unităților de măsură este gol.</EmptyState></Page>
  if (id !== undefined && draft.data === undefined) return <Page title="Draft indisponibil" eyebrow="Document de lucru"><EmptyState>Draftul nu a putut fi încărcat.</EmptyState></Page>
  const backgroundErrors = [customers.error, issuer.error, series.error, unitOfMeasures.error, draft.error].filter((error): error is Error => error !== null)
  return <AuthoringSession key={draft.data?.id ?? "new"} {...(draft.data === undefined ? {} : { initialDraft: draft.data })} issuer={issuer.data} customers={customers.data ?? []} invoiceSeries={invoiceSeries} proformaSeries={proformaSeries} unitOfMeasures={unitOfMeasures.data ?? []} backgroundErrors={backgroundErrors} notify={notify} />
}
