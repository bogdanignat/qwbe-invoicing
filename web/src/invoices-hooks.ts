import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { runUiEffect } from "./api.ts"
import { downloadBlob } from "./browser-download.ts"
import { invoicingClient } from "./invoicing-client.ts"
import type { AuthoringDocumentInput } from "./invoicing-client.ts"
import { authoringPayloadMatchesDraft } from "./invoice-authoring-state.ts"
import { navigate } from "./navigation.ts"
import { evictDraftAfterNavigation } from "./query-cache.ts"

interface InvoiceIssuanceInput {
  readonly draftId: string | undefined
  readonly payload: AuthoringDocumentInput
  readonly canIssue: boolean
  readonly workflowPending: boolean
  readonly confirmMessage: string
}

export const useInvoiceIssuance = (input: InvoiceIssuanceInput) => {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: async () => {
      if (input.draftId === undefined) return runUiEffect(invoicingClient.issueInvoice(input.payload))
      const latest = await runUiEffect(invoicingClient.getDraft(input.draftId))
      if (!authoringPayloadMatchesDraft(input.payload, latest)) throw new Error("Draftul s-a schimbat în altă sesiune. Reîncarcă pagina înainte de emitere.")
      return runUiEffect(invoicingClient.issueDraft(input.draftId))
    },
    onSuccess: async (invoice) => {
      navigate(`/invoices/${encodeURIComponent(invoice.id)}`)
      if (input.draftId !== undefined) evictDraftAfterNavigation(input.draftId, (filter) => { queryClient.removeQueries(filter) })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
      ])
    },
  })
  const canIssue = input.canIssue && !input.workflowPending && !mutation.isPending
  const issue = (): void => {
    if (!canIssue) return
    if (window.confirm(input.confirmMessage)) mutation.mutate()
  }
  return { pending: mutation.isPending, error: mutation.error, canIssue, issue }
}

export const useInvoicesRegistry = () => {
  const queryClient = useQueryClient()
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listInvoices(), signal) })
  const drafts = useQuery({ queryKey: ["drafts"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listDrafts(), signal) })
  const removal = useMutation({
    mutationFn: (id: string) => runUiEffect(invoicingClient.deleteDraft(id)),
    onSuccess: async (_result, id) => {
      queryClient.removeQueries({ queryKey: ["draft", id], exact: true })
      await queryClient.invalidateQueries({ queryKey: ["drafts"] })
    },
  })
  const removeDraft = (id: string, customerName: string): void => {
    if (window.confirm(`Ștergi draftul pentru „${customerName}”?`)) removal.mutate(id)
  }
  return { invoices, drafts, removal: { pending: removal.isPending, error: removal.error, removeDraft } }
}

export const useInvoiceDetail = (id: string) => {
  const bundle = useQuery({ queryKey: ["invoice", id], queryFn: ({ signal }) => runUiEffect(invoicingClient.getInvoiceBundle(id), signal) })
  const download = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.downloadInvoicePdf(id)),
    onSuccess: (blob) => {
      if (bundle.data !== undefined) downloadBlob(blob, `factura-${bundle.data.invoice.series}-${String(bundle.data.invoice.number)}.pdf`)
    },
  })
  return { bundle, download: { pending: download.isPending, error: download.error, start: download.mutate } }
}
