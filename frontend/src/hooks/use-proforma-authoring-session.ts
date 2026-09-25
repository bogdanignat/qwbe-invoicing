"use client"

import { useState } from "react"

import { useAuthoringRecovery } from "./use-authoring-recovery.ts"
import { createInvoiceAuthoringEditorActions } from "./use-invoice-authoring-editor-actions.ts"
import { useProformaSave } from "./use-proforma-save.ts"
import type {
  ProformaAuthoringSession, ProformaAuthoringSessionInput,
} from "./proforma-authoring-session-types.ts"
import { newAuthoringForm } from "../lib/document-authoring-transitions.ts"
import { today } from "../lib/format.ts"
import {
  newEditableInvoiceLine, preferredUnitOfMeasure, type EditableInvoiceLine,
} from "../lib/invoice-authoring-model.ts"
import { documentNotesMaxLength } from "../lib/invoice-notes-validation.ts"
import { issuerIssuanceWarning } from "../lib/invoice-authoring-workflow.ts"
import { knownResultNotice } from "../lib/operation-recovery-view.ts"
import { proformaAuthoringPayload } from "../lib/proforma-authoring-payload.ts"
import { proformaSaveReadiness } from "../lib/proforma-authoring-readiness.ts"
import { countyRequiresSector } from "../lib/romanian-counties.ts"
import { defaultVatCode, vatRatesForIssuer } from "../lib/vat-defaults.ts"
import { issuerForIssueDate } from "../lib/vat-snapshots.ts"

/**
 * The composition behind the proforma authoring screen: the form and the lines
 * as local state, the single write as a controller wired by its hook, and every
 * derived answer computed by pure functions so the components underneath only
 * render.
 *
 * There is no draft here and no issuance step: the proforma is authored whole
 * and is immutable from the moment the server answers, which is why the only
 * write is the save and why an unresolved one closes the screen for good rather
 * than offering a second attempt under a new key.
 */
export const useProformaAuthoringSession = (input: ProformaAuthoringSessionInput): ProformaAuthoringSession => {
  const [form, setForm] = useState(() => newAuthoringForm(
    input.issuer, input.proformaSeries[0] ?? "", input.customers.length > 0, today(),
  ))
  const [lines, setLines] = useState<ReadonlyArray<EditableInvoiceLine>>(() => [newEditableInvoiceLine(
    crypto.randomUUID(),
    defaultVatCode(input.vatCatalogue, input.issuer, today()),
    preferredUnitOfMeasure(input.unitOfMeasures),
  )])
  const recovery = useAuthoringRecovery()
  const payload = proformaAuthoringPayload(form, lines)
  const readiness = proformaSaveReadiness({
    form, lines, seriesOptions: input.proformaSeries,
    pending: recovery.pending, blocked: recovery.blocked,
  })
  const save = useProformaSave({
    payload, canSave: readiness.canSave, blocked: recovery.blocked,
    blockedMessage: undefined, recovery: recovery.port,
  })
  // The journal keeps precedence: its intent may still need a replay, while a
  // confirmed-but-unfollowed save only needs to be read and acknowledged.
  const knownNotice = knownResultNotice(save.knownResult)
  const notice = recovery.notice ?? knownNotice
  const editorActions = createInvoiceAuthoringEditorActions({
    issuer: input.issuer, vatCatalogue: input.vatCatalogue, unitOfMeasures: input.unitOfMeasures,
    productPresets: input.productPresets, customers: input.customers,
    issueDate: form.issueDate, deriveDueDate: true, setForm, setLines,
  })
  const pending = save.pending || recovery.pending
  return {
    document: {
      issuer: issuerForIssueDate(input.issuer, form.issueDate),
      customers: input.customers, customersHasMore: input.customersHasMore,
      customersLoadingMore: input.customersLoadingMore, customersLoadMore: input.customersLoadMore,
      proformaSeries: input.proformaSeries, unitOfMeasures: input.unitOfMeasures, form, lines,
      buyerSectorRequired: countyRequiresSector(form.county), productPresets: input.productPresets,
      presetsHasMore: input.presetsHasMore, presetsLoadingMore: input.presetsLoadingMore,
      presetsLoadMore: input.presetsLoadMore,
      vatRates: vatRatesForIssuer(input.vatCatalogue, input.issuer, form.issueDate),
    },
    feedback: {
      backgroundErrors: input.backgroundErrors,
      // The known-result notice already says what happened; the same effects
      // failure as a second, bare error message only adds noise.
      mutationError: (knownNotice === undefined ? save.error : null) ?? recovery.error,
      unconfirmedMessage: save.unconfirmedMessage,
      issuerWarning: issuerIssuanceWarning(input.issuer),
      notesIssue: readiness.notesIssue,
      notesMaxLength: documentNotesMaxLength,
      dueDateNote: readiness.dueDateNote,
      recoveryNotice: notice,
    },
    status: {
      pending,
      canSave: save.canSave,
      seriesMissing: readiness.seriesMissing,
      recoveryBlocked: recovery.blocked || knownNotice !== undefined,
      recoveryPending: recovery.pending,
    },
    actions: {
      ...editorActions,
      deleteLine: (line) => { setLines((current) => current.filter((item) => item.key !== line.key)) },
      save: save.save,
      replayRecovery: recovery.replay,
      // Dismissing acknowledges the notice that is actually on screen: the saved
      // proforma the screen could not follow, or the journal entry and its replay.
      dismissRecovery: recovery.notice === undefined ? save.reset : recovery.dismiss,
    },
  }
}
