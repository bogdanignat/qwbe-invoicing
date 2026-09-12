import { useState } from "react"

import { today } from "./format.ts"
import {
  authoringDocumentPayload, authoringReadiness, authoringTaxReadiness,
  documentNotesIssue, documentNotesMaxLength, draftLinesForEditing, formFromDraft, newAuthoringForm, newEditableInvoiceLine,
  preferredUnitOfMeasure,
  type EditableInvoiceLine, type InvoiceAuthoringForm,
} from "./invoice-authoring-state.ts"
import { useInvoiceAuthoringCustomers } from "./invoice-authoring-customers-hooks.ts"
import { useInvoiceAuthoringDraft } from "./invoice-authoring-draft-hooks.ts"
import { useInvoiceAuthoringPresets } from "./invoice-authoring-presets-hooks.ts"
import { useInvoiceIssuance } from "./invoices-hooks.ts"
import type { Customer, DraftInvoice, Issuer, UnitOfMeasure, VatCatalogue, VatRate } from "./models.ts"
import { useProformaIssuance, type ProformaIssuanceState } from "./proforma-hooks.ts"
import { defaultVatCode, staleDraftLineIds, vatRatesForIssuer } from "./vat-defaults.ts"

export interface InvoiceAuthoringSessionInput {
  readonly initialDraft?: DraftInvoice
  readonly issuer: Issuer
  readonly vatCatalogue: VatCatalogue
  readonly customers: ReadonlyArray<Customer>
  readonly invoiceSeries: ReadonlyArray<string>
  readonly proformaSeries: ReadonlyArray<string>
  readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
  readonly backgroundErrors: ReadonlyArray<Error>
  readonly notify: (message: string) => void
}

export interface InvoiceAuthoringSessionViewModel {
  readonly document: {
    readonly draft: DraftInvoice | undefined
    readonly issuer: Issuer
    readonly customers: ReadonlyArray<Customer>
    readonly invoiceSeries: ReadonlyArray<string>
    readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
    readonly form: InvoiceAuthoringForm
    readonly lines: ReadonlyArray<EditableInvoiceLine>
    readonly productPresets: ReturnType<typeof useInvoiceAuthoringPresets>["presets"]
    readonly vatRates: ReadonlyArray<VatRate>
  }
  readonly feedback: {
    readonly backgroundErrors: ReadonlyArray<Error>
    readonly mutationError: Error | null
    readonly resumableSave: boolean
    readonly issuerWarning: string | undefined
    readonly staleTaxWarning: string | null
    readonly notesIssue: string | null
    readonly notesMaxLength: number
  }
  readonly status: {
    readonly pending: boolean
    readonly savePending: boolean
    readonly invoicePending: boolean
    readonly canIssueInvoice: boolean
  }
  readonly proformaIssuance: ProformaIssuanceState
  readonly actions: {
    readonly changeForm: (patch: Partial<InvoiceAuthoringForm>) => void
    readonly chooseBuyerMode: ReturnType<typeof useInvoiceAuthoringCustomers>["chooseBuyerMode"]
    readonly chooseCustomer: ReturnType<typeof useInvoiceAuthoringCustomers>["chooseCustomer"]
    readonly chooseIssueDate: ReturnType<typeof useInvoiceAuthoringCustomers>["chooseIssueDate"]
    readonly chooseDueDate: ReturnType<typeof useInvoiceAuthoringCustomers>["chooseDueDate"]
    readonly addLine: () => void
    readonly changeLine: (key: string, patch: Partial<EditableInvoiceLine>) => void
    readonly choosePreset: (lineKey: string, presetId: string) => void
    readonly deleteLine: (line: EditableInvoiceLine) => void
    readonly save: () => void
    readonly issueInvoice: () => void
    readonly deleteDraft: () => void
  }
}

export const useInvoiceAuthoringSession = (input: InvoiceAuthoringSessionInput): InvoiceAuthoringSessionViewModel => {
  const initialDate = today()
  const [form, setForm] = useState<InvoiceAuthoringForm>(() => input.initialDraft === undefined
    ? newAuthoringForm(input.issuer, input.invoiceSeries[0] ?? "", input.customers.length > 0, initialDate)
    : formFromDraft(input.initialDraft))
  const [lines, setLines] = useState<ReadonlyArray<EditableInvoiceLine>>(() => input.initialDraft === undefined
    ? [newEditableInvoiceLine(crypto.randomUUID(), defaultVatCode(input.vatCatalogue, input.issuer, initialDate), preferredUnitOfMeasure(input.unitOfMeasures))]
    : draftLinesForEditing(input.initialDraft))
  const forcedUpdateLineIds = (currentDraft: DraftInvoice): ReadonlyArray<string> =>
    staleDraftLineIds(currentDraft.issueDate, currentDraft.lines, input.vatCatalogue, input.issuer)
  const draftWorkflow = useInvoiceAuthoringDraft({ ...input, form, lines, setLines, forcedUpdateLineIds })
  const { draft } = draftWorkflow
  const authoringCustomers = useInvoiceAuthoringCustomers({ customers: input.customers, issuer: input.issuer, deriveDueDate: draft === undefined, setForm })
  const authoringPresets = useInvoiceAuthoringPresets({ setLines })
  const workflowPending = draftWorkflow.pending
  const readiness = authoringReadiness(form, lines, draft, workflowPending)
  const payload = authoringDocumentPayload(form, lines)
  const vatRates = vatRatesForIssuer(input.vatCatalogue, input.issuer, form.issueDate)
  const staleTax = draft === undefined ? false : forcedUpdateLineIds(draft).length > 0
  const taxReadiness = authoringTaxReadiness(readiness, staleTax)
  const invoiceIssuance = useInvoiceIssuance({
    draftId: draft?.id, payload, canIssue: taxReadiness.canIssue, workflowPending,
    confirmMessage: "Emiți factura? Numărul și documentul fiscal devin imuabile.",
  })
  const proformaIssuance = useProformaIssuance({
    draftId: draft?.id, payload, editable: readiness.editable, series: input.proformaSeries,
    synchronized: taxReadiness.synchronized, hasLines: readiness.hasLines,
    workflowPending: workflowPending || invoiceIssuance.pending,
  })
  const pending = workflowPending || invoiceIssuance.pending || proformaIssuance.pending

  return {
    document: {
      draft, issuer: input.issuer, customers: input.customers, invoiceSeries: input.invoiceSeries,
      unitOfMeasures: input.unitOfMeasures, form, lines, productPresets: authoringPresets.presets, vatRates,
    },
    feedback: {
      backgroundErrors: [...input.backgroundErrors, authoringPresets.error].filter((error): error is Error => error !== null),
      mutationError: draftWorkflow.error ?? invoiceIssuance.error,
      resumableSave: draftWorkflow.resumableSave,
      issuerWarning: authoringCustomers.issuerWarning, staleTaxWarning: taxReadiness.warning,
      notesIssue: documentNotesIssue(form.notes), notesMaxLength: documentNotesMaxLength,
    },
    status: {
      pending, savePending: draftWorkflow.savePending, invoicePending: invoiceIssuance.pending,
      canIssueInvoice: invoiceIssuance.canIssue && !proformaIssuance.pending,
    },
    proformaIssuance,
    actions: {
      changeForm: (patch) => { setForm((current) => ({ ...current, ...patch })) },
      chooseBuyerMode: authoringCustomers.chooseBuyerMode, chooseCustomer: authoringCustomers.chooseCustomer,
      chooseIssueDate: authoringCustomers.chooseIssueDate, chooseDueDate: authoringCustomers.chooseDueDate,
      addLine: () => { setLines((current) => [...current, newEditableInvoiceLine(crypto.randomUUID(), defaultVatCode(input.vatCatalogue, input.issuer, form.issueDate), preferredUnitOfMeasure(input.unitOfMeasures))]) },
      changeLine: (key, patch) => { setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line)) },
      choosePreset: authoringPresets.choosePreset,
      deleteLine: draftWorkflow.deleteLine,
      save: draftWorkflow.save,
      issueInvoice: invoiceIssuance.issue,
      deleteDraft: draftWorkflow.deleteDraft,
    },
  }
}
