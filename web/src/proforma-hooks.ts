import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { runUiEffect } from "./api.ts"
import { downloadBlob } from "./browser-download.ts"
import { invoicingClient } from "./invoicing-client.ts"
import type { AuthoringDocumentInput } from "./invoicing-client.ts"
import { authoringPayloadMatchesDraft } from "./invoice-authoring-state.ts"
import { navigate } from "./navigation.ts"
import { proformaIssuanceAvailability } from "./proforma-state.ts"
import { evictDraftAfterNavigation } from "./query-cache.ts"

interface ProformaIssuanceInput {
  readonly draftId: string | undefined
  readonly payload: AuthoringDocumentInput
  readonly editable: boolean
  readonly series: ReadonlyArray<string>
  readonly synchronized: boolean
  readonly hasLines: boolean
  readonly workflowPending: boolean
}

export interface ProformaIssuanceState {
  readonly visible: boolean
  readonly series: ReadonlyArray<string>
  readonly selectedSeries: string
  readonly pending: boolean
  readonly error: Error | null
  readonly canIssue: boolean
  readonly disabledReason: string | null
  readonly selectSeries: (series: string) => void
  readonly issue: () => void
}

export const useProformaIssuance = (input: ProformaIssuanceInput): ProformaIssuanceState => {
  const queryClient = useQueryClient()
  const [selection, setSelection] = useState(input.series[0] ?? "")
  const selectedSeries = input.series.includes(selection) ? selection : input.series[0] ?? ""
  const mutation = useMutation({
    mutationFn: async () => {
      if (selectedSeries === "") return Promise.reject(new Error("Selectează o serie de proformă."))
      if (input.draftId === undefined) return runUiEffect(invoicingClient.issueProforma({ ...input.payload, proformaSeries: selectedSeries }))
      const latest = await runUiEffect(invoicingClient.getDraft(input.draftId))
      if (!authoringPayloadMatchesDraft(input.payload, latest)) throw new Error("Draftul s-a schimbat în altă sesiune. Reîncarcă pagina înainte de emitere.")
      return runUiEffect(invoicingClient.issueDraftProforma(input.draftId, selectedSeries))
    },
    onSuccess: async (proforma) => {
      navigate(`/proformas/${encodeURIComponent(proforma.id)}`)
      if (input.draftId !== undefined) evictDraftAfterNavigation(input.draftId, (filter) => { queryClient.removeQueries(filter) })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["proformas"] }),
      ])
    },
  })
  const availability = proformaIssuanceAvailability({
    hasSavedDraft: input.draftId !== undefined,
    editable: input.editable,
    synchronized: input.synchronized,
    hasLines: input.hasLines,
    workflowPending: input.workflowPending,
    issuancePending: mutation.isPending,
    hasSeries: selectedSeries !== "",
  })
  const issue = (): void => {
    if (!availability.canIssue) return
    if (window.confirm(`Emiți proforma din seria ${selectedSeries}? Va primi un număr și va deveni un document comercial imuabil, nefiscal.`)) mutation.mutate()
  }
  return {
    visible: availability.visible, series: input.series, selectedSeries, pending: mutation.isPending, error: mutation.error,
    canIssue: availability.canIssue, disabledReason: availability.disabledReason, selectSeries: setSelection, issue,
  }
}

export const useProformas = () => useQuery({
  queryKey: ["proformas"],
  queryFn: ({ signal }) => runUiEffect(invoicingClient.listProformas(), signal),
})

export const useProformaDetail = (id: string) => {
  const queryClient = useQueryClient()
  const proforma = useQuery({
    queryKey: ["proforma", id],
    queryFn: ({ signal }) => runUiEffect(invoicingClient.getProforma(id), signal),
  })
  const issuance = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.issueInvoiceFromProforma(id)),
    onSuccess: async (invoice) => {
      navigate(`/invoices/${encodeURIComponent(invoice.id)}`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["proformas"] }),
        queryClient.invalidateQueries({ queryKey: ["proforma", id] }),
      ])
    },
  })
  const download = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.downloadProformaPdf(id)),
    onSuccess: (blob) => {
      if (proforma.data !== undefined) downloadBlob(blob, `proforma-${proforma.data.series}-${String(proforma.data.number)}.pdf`)
    },
  })
  const issueInvoice = (): void => {
    const value = proforma.data
    if (value === undefined || value.convertedDraftId !== null || value.convertedInvoiceId !== null) return
    if (window.confirm("Emiți factura din această proformă? Datele și totalurile sunt copiate exact, iar factura primește număr fiscal.")) issuance.mutate()
  }
  return {
    proforma,
    issuance: { pending: issuance.isPending, error: issuance.error, issueInvoice },
    download: { pending: download.isPending, error: download.error, start: download.mutate },
  }
}
