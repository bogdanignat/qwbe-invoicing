import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, type Dispatch, type SetStateAction } from "react"

import { runUiEffect } from "./api.ts"
import {
  createDraftPayload, draftLinePayload, draftLinesForEditing, headerMatchesDraft, pendingLineOperations, updateDraftPayload,
  type EditableInvoiceLine, type InvoiceAuthoringForm,
} from "./invoice-authoring-state.ts"
import { invoicingClient } from "./invoicing-client.ts"
import type { DraftInvoice } from "./models.ts"
import { navigate } from "./navigation.ts"

interface DraftEditingInput {
  readonly initialDraft?: DraftInvoice
  readonly form: InvoiceAuthoringForm
  readonly lines: ReadonlyArray<EditableInvoiceLine>
  readonly setLines: Dispatch<SetStateAction<ReadonlyArray<EditableInvoiceLine>>>
  readonly forcedUpdateLineIds: (draft: DraftInvoice) => ReadonlyArray<string>
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

export const useInvoiceAuthoringDraft = (input: DraftEditingInput) => {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(input.initialDraft)
  const recordServerDraft = (updated: DraftInvoice): void => {
    setDraft(updated)
    queryClient.setQueryData(["draft", updated.id], updated)
  }
  const saveMutation = useMutation({
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
      for (const operation of pendingLineOperations(workingLines, currentDraft, input.forcedUpdateLineIds(currentDraft))) {
        const previousIds = new Set(currentDraft.lines.map((line) => line.id))
        const updated = operation.kind === "create"
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
        input.setLines(workingLines)
      }
      return { draft: currentDraft, lines: workingLines }
    },
    onSuccess: (result) => {
      recordServerDraft(result.draft)
      input.setLines(result.lines)
      if (input.initialDraft === undefined) navigate(`/drafts/${encodeURIComponent(result.draft.id)}`, { replace: true })
      input.notify("Toate modificările draftului au fost salvate.")
    },
    onSettled: async () => { await queryClient.invalidateQueries({ queryKey: ["drafts"] }) },
  })
  const removeLine = useMutation({
    mutationFn: (line: EditableInvoiceLine) => draft === undefined || line.lineId === undefined
      ? Promise.reject(new Error("Linia nu este salvată."))
      : runUiEffect(invoicingClient.deleteDraftLine(draft.id, line.lineId)),
    onSuccess: async (updated, removed) => {
      recordServerDraft(updated)
      input.setLines((current) => current.filter((line) => line.key !== removed.key))
      await queryClient.invalidateQueries({ queryKey: ["drafts"] })
      input.notify("Linia a fost ștearsă.")
    },
  })
  const removeDraft = useMutation({
    mutationFn: () => draft === undefined ? Promise.reject(new Error("Draftul nu este salvat.")) : runUiEffect(invoicingClient.deleteDraft(draft.id)),
    onSuccess: async () => {
      navigate("/invoices")
      if (draft !== undefined) window.setTimeout(() => { queryClient.removeQueries({ queryKey: ["draft", draft.id], exact: true }) }, 0)
      await queryClient.invalidateQueries({ queryKey: ["drafts"] })
      input.notify("Draftul a fost șters.")
    },
  })
  const pending = saveMutation.isPending || removeLine.isPending || removeDraft.isPending
  return {
    draft, pending, savePending: saveMutation.isPending,
    error: saveMutation.error ?? removeLine.error ?? removeDraft.error,
    resumableSave: input.initialDraft === undefined && draft !== undefined && saveMutation.error !== null,
    save: () => { saveMutation.mutate({ draft, form: input.form, lines: input.lines }) },
    deleteLine: (line: EditableInvoiceLine) => {
      if (line.lineId === undefined) { input.setLines((current) => current.filter((item) => item.key !== line.key)); return }
      if (window.confirm(`Ștergi linia „${line.description}” din draft?`)) removeLine.mutate(line)
    },
    deleteDraft: () => { if (window.confirm("Ștergi definitiv acest draft?")) removeDraft.mutate() },
  }
}
