import { useState } from "react"

import { today } from "../lib/format.ts"
import {
  authoringDocumentPayload, authoringReadiness, authoringTaxReadiness,
  documentNotesIssue, documentNotesMaxLength, draftLinesForEditing,
  formFromDraft, newAuthoringForm, newEditableInvoiceLine,
  preferredUnitOfMeasure,
  positiveInvoiceRequiresDueDate,
  type EditableInvoiceLine, type InvoiceAuthoringForm,
} from "../lib/invoice-authoring-state.ts"
import { useInvoiceAuthoringCustomers } from "./invoice-authoring-customers-hooks.ts"
import { useInvoiceAuthoringDraft } from "./invoice-authoring-draft-hooks.ts"
import { useInvoiceAuthoringPresets } from "./invoice-authoring-presets-hooks.ts"
import { useInvoiceIssuance } from "./invoices-hooks.ts"
import type { DraftInvoice } from "../lib/models.ts"
import { countyRequiresSector } from "../lib/romanian-counties.ts"
import { defaultVatCode, issuerForIssueDate, presetVatCode, staleDraftLineIds, vatRatesForIssuer } from "../lib/vat-defaults.ts"
import {
  authoringBackgroundErrors, draftDeletionState, invoiceDueDateIssue,
} from "../lib/invoice-authoring-workflow.ts"
import type { InvoiceAuthoringSessionInput, InvoiceAuthoringSessionViewModel } from "./invoice-authoring-session-types.ts"
import { createInvoiceAuthoringEditorActions } from "./invoice-authoring-editor-actions.ts"

export type { InvoiceAuthoringSessionInput, InvoiceAuthoringSessionViewModel } from "./invoice-authoring-session-types.ts"

export const useInvoiceAuthoringSession = (input: InvoiceAuthoringSessionInput): InvoiceAuthoringSessionViewModel => {
  const initialDate = today()
  const [form, setForm] = useState<InvoiceAuthoringForm>(() => input.initialDraft === undefined
    ? newAuthoringForm(input.issuer, input.invoiceSeries[0] ?? "", input.customers.length > 0, initialDate)
    : formFromDraft(input.initialDraft))
  const [lines, setLines] = useState<ReadonlyArray<EditableInvoiceLine>>(() => input.initialDraft === undefined
    ? [newEditableInvoiceLine(
        crypto.randomUUID(),
        defaultVatCode(input.vatCatalogue, input.issuer, initialDate),
        preferredUnitOfMeasure(input.unitOfMeasures),
      )]
    : draftLinesForEditing(input.initialDraft))
  const forcedUpdateLineIds = (currentDraft: DraftInvoice): ReadonlyArray<string> =>
    staleDraftLineIds(currentDraft.issueDate, currentDraft.lines, input.vatCatalogue, input.issuer)
  const draftWorkflow = useInvoiceAuthoringDraft({ ...input, form, lines, setLines, forcedUpdateLineIds })
  const { draft } = draftWorkflow
  const buyers = useInvoiceAuthoringCustomers({ customers: input.customers, issuer: input.issuer, deriveDueDate: draft === undefined, setForm })
  const presets = useInvoiceAuthoringPresets({
    setLines, vatCodeFor: (preferred) => presetVatCode(preferred, input.vatCatalogue, input.issuer, form.issueDate),
  })
  const workflowPending = draftWorkflow.pending
  const readiness = authoringReadiness(form, lines, draft, workflowPending)
  const payload = authoringDocumentPayload(form, lines)
  const vatRates = vatRatesForIssuer(input.vatCatalogue, input.issuer, form.issueDate)
  const staleTax = draft === undefined ? false : forcedUpdateLineIds(draft).length > 0
  const taxReadiness = authoringTaxReadiness(readiness, staleTax)
  const dueDateRequired = positiveInvoiceRequiresDueDate(form.dueDate, readiness.synchronized ? draft?.totalIncludingVat : undefined, lines)
  const invoiceIssuance = useInvoiceIssuance({
    draftId: draft?.id, payload, canIssue: taxReadiness.canIssue && !dueDateRequired, workflowPending,
    confirmMessage: "Emiți factura? Numărul și documentul fiscal devin imuabile.",
  })
  const pending = workflowPending || invoiceIssuance.pending
  const draftDeletion = draftDeletionState(draft)
  const editorActions = createInvoiceAuthoringEditorActions({
    issuer: input.issuer,
    vatCatalogue: input.vatCatalogue,
    unitOfMeasures: input.unitOfMeasures,
    issueDate: form.issueDate,
    setForm,
    setLines,
  })

  return {
    document: {
      draft, issuer: issuerForIssueDate(input.issuer, form.issueDate), customers: input.customers, invoiceSeries: input.invoiceSeries,
      unitOfMeasures: input.unitOfMeasures, form, lines, productPresets: presets.presets, vatRates,
      buyerSectorRequired: countyRequiresSector(form.county),
    },
    feedback: {
      backgroundErrors: authoringBackgroundErrors(input.backgroundErrors, presets.error),
      mutationError: draftWorkflow.error ?? invoiceIssuance.error,
      resumableSave: draftWorkflow.resumableSave,
      issuerWarning: buyers.issuerWarning, staleTaxWarning: taxReadiness.warning,
      notesIssue: documentNotesIssue(form.notes), notesMaxLength: documentNotesMaxLength,
      dueDateIssue: invoiceDueDateIssue(dueDateRequired),
    },
    status: {
      pending, savePending: draftWorkflow.savePending, invoicePending: invoiceIssuance.pending,
      canIssueInvoice: invoiceIssuance.canIssue,
      dueDateRequired,
    },
    draftDeletion,
    actions: {
      changeForm: editorActions.changeForm,
      chooseBuyerMode: buyers.chooseBuyerMode, chooseCustomer: buyers.chooseCustomer,
      chooseIssueDate: buyers.chooseIssueDate, chooseDueDate: buyers.chooseDueDate,
      choosePartyType: editorActions.choosePartyType,
      chooseCounty: editorActions.chooseCounty,
      changeFiscalIdentifier: editorActions.changeFiscalIdentifier,
      chooseSector: editorActions.chooseSector,
      addLine: editorActions.addLine,
      changeLine: editorActions.changeLine,
      choosePreset: presets.choosePreset,
      deleteLine: draftWorkflow.deleteLine,
      save: draftWorkflow.save,
      issueInvoice: invoiceIssuance.issue,
      deleteDraft: draftWorkflow.deleteDraft,
    },
  }
}
