import { useState } from "react"

import { useInvoiceAuthoringDraft } from "./use-invoice-authoring-draft.ts"
import { useInvoiceIssuance } from "./use-invoice-issuance.ts"
import { createInvoiceAuthoringEditorActions } from "./use-invoice-authoring-editor-actions.ts"
import type { InvoiceAuthoringSession, InvoiceAuthoringSessionInput } from "./invoice-authoring-session-types.ts"
import { today } from "../lib/format.ts"
import { authoringDocumentPayload } from "../lib/invoice-authoring-payload.ts"
import { authoringReadiness, authoringTaxReadiness } from "../lib/invoice-authoring-readiness.ts"
import { draftLinesForEditing } from "../lib/invoice-authoring-options.ts"
import { formFromDraft, newAuthoringForm } from "../lib/invoice-authoring-transitions.ts"
import { newEditableInvoiceLine, preferredUnitOfMeasure } from "../lib/invoice-authoring-model.ts"
import { derivedDraftNotice, draftDeletionState, invoiceDueDateIssue, issuerIssuanceWarning } from "../lib/invoice-authoring-workflow.ts"
import { documentNotesIssue, documentNotesMaxLength } from "../lib/invoice-notes-validation.ts"
import { positiveInvoiceRequiresDueDate } from "../lib/invoice-positive-total.ts"
import { countyRequiresSector } from "../lib/romanian-counties.ts"
import { defaultVatCode, vatRatesForIssuer } from "../lib/vat-defaults.ts"
import { issuerForIssueDate, staleDraftLineIds } from "../lib/vat-snapshots.ts"
import type { DraftInvoice } from "../lib/draft-models.ts"

/**
 * The composition behind one authoring screen: the form and lines as local
 * state, the draft workflow and issuance as controllers wired by their hooks,
 * and every derived answer — readiness, stale tax, the due-date requirement —
 * computed here so the components underneath only render.
 */
export const useInvoiceAuthoringSession = (input: InvoiceAuthoringSessionInput): InvoiceAuthoringSession => {
  const [form, setForm] = useState(() => input.initialDraft === undefined
    ? newAuthoringForm(input.issuer, input.invoiceSeries[0] ?? "", input.customers.length > 0, today())
    : formFromDraft(input.initialDraft))
  const [lines, setLines] = useState(() => input.initialDraft === undefined
    ? [newEditableInvoiceLine(
        crypto.randomUUID(),
        defaultVatCode(input.vatCatalogue, input.issuer, today()),
        preferredUnitOfMeasure(input.unitOfMeasures),
      )]
    : draftLinesForEditing(input.initialDraft))
  const forcedUpdateLineIds = (currentDraft: DraftInvoice): ReadonlyArray<string> =>
    staleDraftLineIds(currentDraft.issueDate, currentDraft.lines, input.vatCatalogue, input.issuer)
  const draftWorkflow = useInvoiceAuthoringDraft({
    initialDraft: input.initialDraft, form, lines, setLines, forcedUpdateLineIds,
  })
  const { draft } = draftWorkflow
  const workflowPending = draftWorkflow.pending
  const readiness = authoringReadiness(form, lines, draft, workflowPending)
  const payload = authoringDocumentPayload(form, lines)
  const vatRates = vatRatesForIssuer(input.vatCatalogue, input.issuer, form.issueDate)
  const staleTax = draft === undefined ? false : forcedUpdateLineIds(draft).length > 0
  const taxReadiness = authoringTaxReadiness(readiness, staleTax)
  const dueDateRequired = positiveInvoiceRequiresDueDate(
    form.dueDate, readiness.synchronized ? draft?.totalIncludingVat : undefined, lines,
  )
  // A save whose create outcome is unknown blocks every other write — most
  // importantly issuance, which could seal an unidentified document and later
  // orphan the draft into a second fiscal invoice.
  const issuanceBlock = draftWorkflow.unconfirmedMessage
  const invoiceIssuance = useInvoiceIssuance({
    draftId: draft?.id, payload,
    canIssue: taxReadiness.canIssue && !dueDateRequired && issuanceBlock === undefined,
    workflowPending, blockedMessage: issuanceBlock,
  })
  // An issuance whose outcome is unknown freezes the document instead: only
  // an explicit retry of the exact same payload (the controller refuses an
  // edited one locally) may be sent, so editing and saving are held back.
  const issueUnconfirmed = invoiceIssuance.unconfirmedMessage
  const editorActions = createInvoiceAuthoringEditorActions({
    issuer: input.issuer, vatCatalogue: input.vatCatalogue, unitOfMeasures: input.unitOfMeasures,
    productPresets: input.productPresets, customers: input.customers, issueDate: form.issueDate,
    deriveDueDate: draft === undefined, setForm, setLines,
  })
  const pending = workflowPending || invoiceIssuance.pending || issueUnconfirmed !== undefined
  return {
    document: {
      draft, issuer: issuerForIssueDate(input.issuer, form.issueDate), customers: input.customers,
      customersHasMore: input.customersHasMore, customersLoadingMore: input.customersLoadingMore,
      customersLoadMore: input.customersLoadMore,
      invoiceSeries: input.invoiceSeries, unitOfMeasures: input.unitOfMeasures, form, lines,
      savedBuyer: draft?.customerId !== undefined
        ? { customerId: draft.customerId, customer: draft.customer }
        : undefined,
      buyerSectorRequired: countyRequiresSector(form.county), productPresets: input.productPresets,
      presetsHasMore: input.presetsHasMore, presetsLoadingMore: input.presetsLoadingMore,
      presetsLoadMore: input.presetsLoadMore, vatRates,
    },
    feedback: {
      backgroundErrors: input.backgroundErrors,
      mutationError: draftWorkflow.error ?? invoiceIssuance.error,
      resumableSave: draftWorkflow.resumableSave,
      unconfirmedMessage: draftWorkflow.unconfirmedMessage,
      issueUnconfirmedMessage: issueUnconfirmed,
      issuerWarning: issuerIssuanceWarning(input.issuer), staleTaxWarning: taxReadiness.warning,
      notesIssue: documentNotesIssue(form.notes), notesMaxLength: documentNotesMaxLength,
      dueDateIssue: invoiceDueDateIssue(dueDateRequired), notice: draftWorkflow.notice,
    },
    status: {
      pending, savePending: draftWorkflow.savePending, invoicePending: invoiceIssuance.pending,
      canIssueInvoice: invoiceIssuance.canIssue, dueDateRequired,
    },
    draftDeletion: draftDeletionState(draft),
    derivedNotice: derivedDraftNotice,
    actions: {
      ...editorActions,
      deleteLine: draftWorkflow.deleteLine,
      save: draftWorkflow.save,
      issueInvoice: invoiceIssuance.issue,
      deleteDraft: draftWorkflow.deleteDraft,
    },
  }
}
