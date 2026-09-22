import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { runUiEffect } from "../lib/api.ts"
import { downloadBlob } from "../lib/browser-download.ts"
import { invoicingClient } from "../lib/invoicing-client.ts"
import type { AuthoringDocumentInput } from "../lib/invoicing-client.ts"
import { authoringPayloadMatchesDraft } from "../lib/invoice-authoring-state.ts"
import { useIdempotencyKey } from "./idempotency-key.ts"
import { navigate } from "../lib/navigation.ts"
import { usePagedList } from "./paged-query.ts"
import { evictDraftAfterNavigation, invalidateInvoiceRegister, invoiceRegisterQueryKey } from "../lib/query-cache.ts"
import { projectInvoiceRegisterRow } from "../lib/invoice-register.ts"

interface InvoiceIssuanceInput {
  readonly draftId: string | undefined
  readonly payload: AuthoringDocumentInput
  readonly canIssue: boolean
  readonly workflowPending: boolean
  readonly confirmMessage: string
}

export const useInvoiceIssuance = (input: InvoiceIssuanceInput) => {
  const queryClient = useQueryClient()
  const idempotency = useIdempotencyKey()
  const mutation = useMutation({
    mutationFn: async () => {
      if (input.draftId === undefined) return runUiEffect(invoicingClient.issueInvoice(input.payload, idempotency.current()))
      const latest = await runUiEffect(invoicingClient.getDraft(input.draftId))
      if (!authoringPayloadMatchesDraft(input.payload, latest)) throw new Error("Draftul s-a schimbat în altă sesiune. Reîncarcă pagina înainte de emitere.")
      return runUiEffect(invoicingClient.issueDraft(input.draftId, idempotency.current()))
    },
    onSuccess: async (invoice) => {
      idempotency.complete()
      navigate(`/invoices/${encodeURIComponent(invoice.id)}`)
      if (input.draftId !== undefined) evictDraftAfterNavigation(input.draftId, (filter) => { queryClient.removeQueries(filter) })
      await Promise.all([
        invalidateInvoiceRegister(queryClient),
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
      ])
    },
    onError: idempotency.fail,
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
  const register = usePagedList(invoiceRegisterQueryKey, (page) => invoicingClient.listInvoiceRegister(page))
  const drafts = usePagedList(["drafts"], (page) => invoicingClient.listDrafts(page))
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
  const registerRows = register.items?.map(projectInvoiceRegisterRow)
  return { register: { ...register, items: registerRows }, drafts, removal: { pending: removal.isPending, error: removal.error, removeDraft } }
}

export const useInvoiceDetail = (id: string) => {
  const bundle = useQuery({ queryKey: ["invoice", id], queryFn: ({ signal }) => runUiEffect(invoicingClient.getInvoiceBundle(id), signal) })
  const download = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.downloadInvoicePdf(id)),
    onSuccess: (blob) => {
      if (bundle.data !== undefined) downloadBlob(blob, `factura-${bundle.data.invoice.series}-${String(bundle.data.invoice.number)}.pdf`)
    },
  })
  const efactura = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.downloadInvoiceEFactura(id)),
    onSuccess: (blob) => {
      if (bundle.data !== undefined) downloadBlob(blob, `efactura-${bundle.data.invoice.series}-${String(bundle.data.invoice.number)}.xml`)
    },
  })
  return {
    bundle,
    download: { pending: download.isPending, error: download.error, start: download.mutate },
    efactura: { pending: efactura.isPending, error: efactura.error, start: efactura.mutate },
  }
}
