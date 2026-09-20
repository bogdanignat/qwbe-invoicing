import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { runUiEffect } from "../lib/api.ts"
import { today } from "../lib/format.ts"
import {
  authoringReadiness, documentNotesIssue, documentNotesMaxLength, newAuthoringForm,
  newEditableInvoiceLine, preferredUnitOfMeasure, type EditableInvoiceLine,
} from "../lib/invoice-authoring-state.ts"
import { invoicingClient, type AuthoringProformaInput } from "../lib/invoicing-client.ts"
import { navigate } from "../lib/navigation.ts"
import { proformaAuthoringPayload } from "../lib/proforma-authoring-state.ts"
import { authoringBackgroundErrors } from "../lib/invoice-authoring-workflow.ts"
import { countyRequiresSector } from "../lib/romanian-counties.ts"
import {
  defaultVatCode, issuerForIssueDate, presetVatCode, vatRatesForIssuer,
} from "../lib/vat-defaults.ts"
import { useInvoiceAuthoringCustomers } from "./invoice-authoring-customers-hooks.ts"
import { useInvoiceAuthoringPresets } from "./invoice-authoring-presets-hooks.ts"
import { useOperationIdempotency } from "./operation-idempotency.ts"
import type {
  ProformaAuthoringSessionInput, ProformaAuthoringSessionViewModel,
} from "./proforma-authoring-types.ts"
import { createInvoiceAuthoringEditorActions } from "./invoice-authoring-editor-actions.ts"

export { useProformaAuthoringPage } from "./proforma-authoring-page-hooks.ts"
export type { ProformaAuthoringPageState } from "./proforma-authoring-page-hooks.ts"
export type {
  ProformaAuthoringSessionInput, ProformaAuthoringSessionViewModel,
} from "./proforma-authoring-types.ts"

export const useProformaAuthoringSession = (
  input: ProformaAuthoringSessionInput,
): ProformaAuthoringSessionViewModel => {
  const queryClient = useQueryClient()
  const idempotency = useOperationIdempotency()
  const initialDate = today()
  const [form, setForm] = useState(() => newAuthoringForm(
    input.issuer,
    input.proformaSeries[0] ?? "",
    input.customers.length > 0,
    initialDate,
  ))
  const [lines, setLines] = useState<ReadonlyArray<EditableInvoiceLine>>(() => [
    newEditableInvoiceLine(
      crypto.randomUUID(),
      defaultVatCode(input.vatCatalogue, input.issuer, initialDate),
      preferredUnitOfMeasure(input.unitOfMeasures),
    ),
  ])
  const customers = useInvoiceAuthoringCustomers({
    customers: input.customers,
    issuer: input.issuer,
    deriveDueDate: true,
    setForm,
  })
  const presets = useInvoiceAuthoringPresets({
    setLines,
    vatCodeFor: (preferred) => presetVatCode(
      preferred,
      input.vatCatalogue,
      input.issuer,
      form.issueDate,
    ),
  })
  const readiness = authoringReadiness(form, lines, undefined, false)
  const mutation = useMutation({
    mutationFn: (request: {
      readonly payload: AuthoringProformaInput
      readonly fingerprint: string
    }) => runUiEffect(invoicingClient.issueProforma(
      request.payload,
      idempotency.current("create-proforma", request.fingerprint),
    )),
    onSuccess: async (proforma) => {
      idempotency.complete("create-proforma")
      navigate(`/proformas/${encodeURIComponent(proforma.id)}`)
      await queryClient.invalidateQueries({ queryKey: ["proformas"] })
    },
    onError: (error, request) => {
      idempotency.fail("create-proforma", request.fingerprint, error)
    },
  })
  const canSave = readiness.hasLines
    && form.series !== ""
    && !mutation.isPending
    && documentNotesIssue(form.notes) === null
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
      issuer: issuerForIssueDate(input.issuer, form.issueDate),
      customers: input.customers,
      proformaSeries: input.proformaSeries,
      unitOfMeasures: input.unitOfMeasures,
      form,
      lines,
      buyerSectorRequired: countyRequiresSector(form.county),
      productPresets: presets.presets,
      vatRates: vatRatesForIssuer(input.vatCatalogue, input.issuer, form.issueDate),
    },
    feedback: {
      backgroundErrors: authoringBackgroundErrors(input.backgroundErrors, presets.error),
      mutationError: mutation.error,
      issuerWarning: customers.issuerWarning,
      notesIssue: documentNotesIssue(form.notes),
      notesMaxLength: documentNotesMaxLength,
    },
    status: {
      pending: mutation.isPending,
      canSave,
      seriesMissing: input.proformaSeries.length === 0,
    },
    actions: {
      changeForm: editorActions.changeForm,
      chooseBuyerMode: customers.chooseBuyerMode,
      chooseCustomer: customers.chooseCustomer,
      chooseIssueDate: customers.chooseIssueDate,
      chooseDueDate: customers.chooseDueDate,
      choosePartyType: editorActions.choosePartyType,
      chooseCounty: editorActions.chooseCounty,
      changeFiscalIdentifier: editorActions.changeFiscalIdentifier,
      chooseSector: editorActions.chooseSector,
      addLine: editorActions.addLine,
      changeLine: editorActions.changeLine,
      choosePreset: presets.choosePreset,
      deleteLine: (line) => {
        setLines((current) => current.filter((item) => item.key !== line.key))
      },
      save: () => {
        if (!canSave || !window.confirm(
          "Salvezi proforma? Va primi un număr și va deveni un document comercial imuabil, nefiscal.",
        )) return
        const payload = proformaAuthoringPayload(form, lines)
        mutation.mutate({ payload, fingerprint: JSON.stringify(payload) })
      },
    },
  }
}
