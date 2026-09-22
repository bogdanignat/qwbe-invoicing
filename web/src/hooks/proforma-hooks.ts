import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { runUiEffect } from "../lib/api.ts"
import { downloadBlob } from "../lib/browser-download.ts"
import { invoicingClient } from "../lib/invoicing-client.ts"
import { useOperationIdempotency } from "./operation-idempotency.ts"
import { navigate } from "../lib/navigation.ts"
import { usePagedList } from "./paged-query.ts"
import { positiveInvoiceRequiresDueDate } from "../lib/invoice-authoring-state.ts"
import { invalidateInvoiceRegister } from "../lib/query-cache.ts"

export const useProformas = () => usePagedList(["proformas"], (page) => invoicingClient.listProformas(page))

export const useProformaDetail = (id: string) => {
  const queryClient = useQueryClient()
  const idempotency = useOperationIdempotency()
  const [selectedSeries, setSelectedSeries] = useState("")
  const proforma = useQuery({
    queryKey: ["proforma", id],
    queryFn: ({ signal }) => runUiEffect(invoicingClient.getProforma(id), signal),
  })
  const canConvert = proforma.data !== undefined && proforma.data.convertedDraftId === null && proforma.data.convertedInvoiceId === null
  const series = useQuery({
    queryKey: ["document-series", "proforma-conversion", id], enabled: canConvert,
    queryFn: ({ signal }) => runUiEffect(invoicingClient.listDocumentSeries(), signal),
  })
  const invoiceSeries = (series.data ?? []).filter((item) => item.documentType === "invoice").map((item) => item.series)
  const effectiveSeries = invoiceSeries.includes(selectedSeries) ? selectedSeries : ""
  const issuance = useMutation({
    mutationFn: (invoiceSeries: string) => runUiEffect(invoicingClient.issueInvoiceFromProforma(id, invoiceSeries, idempotency.current("invoice", invoiceSeries))),
    onSuccess: async (invoice) => {
      idempotency.complete("invoice")
      navigate(`/invoices/${encodeURIComponent(invoice.id)}`)
      await Promise.all([
        invalidateInvoiceRegister(queryClient),
        queryClient.invalidateQueries({ queryKey: ["proformas"] }),
        queryClient.invalidateQueries({ queryKey: ["proforma", id] }),
      ])
    },
    onError: (error, fingerprint) => { idempotency.fail("invoice", fingerprint, error) },
  })
  const draftCreation = useMutation({
    mutationFn: (invoiceSeries: string) => runUiEffect(invoicingClient.createDraftFromProforma(id, invoiceSeries, idempotency.current("draft", invoiceSeries))),
    onSuccess: async (draft) => {
      idempotency.complete("draft")
      navigate(`/drafts/${encodeURIComponent(draft.id)}`)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["drafts"] }),
        queryClient.invalidateQueries({ queryKey: ["proformas"] }),
        queryClient.invalidateQueries({ queryKey: ["proforma", id] }),
      ])
    },
    onError: (error, fingerprint) => { idempotency.fail("draft", fingerprint, error) },
  })
  const download = useMutation({
    mutationFn: () => runUiEffect(invoicingClient.downloadProformaPdf(id)),
    onSuccess: (blob) => {
      if (proforma.data !== undefined) downloadBlob(blob, `proforma-${proforma.data.series}-${String(proforma.data.number)}.pdf`)
    },
  })
  const conversionPending = issuance.isPending || draftCreation.isPending
  const dueDateRequired = proforma.data === undefined ? false : positiveInvoiceRequiresDueDate(proforma.data.dueDate, proforma.data.totalIncludingVat)
  const converted = proforma.data?.convertedInvoiceId !== null && proforma.data?.convertedInvoiceId !== undefined
    ? { kind: "invoice" as const, href: `/invoices/${encodeURIComponent(proforma.data.convertedInvoiceId)}` }
    : proforma.data?.convertedDraftId !== null && proforma.data?.convertedDraftId !== undefined
      ? { kind: "draft" as const, href: `/drafts/${encodeURIComponent(proforma.data.convertedDraftId)}` }
      : { kind: "available" as const }
  const issueInvoice = (): void => {
    if (!canConvert || effectiveSeries === "" || conversionPending || dueDateRequired) return
    if (window.confirm("Emiți factura din această proformă? Liniile și totalurile sunt copiate exact; factura primește data de azi, scadența cu același termen și următorul număr din serie.")) issuance.mutate(effectiveSeries)
  }
  const createDraft = (): void => {
    if (!canConvert || effectiveSeries === "" || conversionPending) return
    draftCreation.mutate(effectiveSeries)
  }
  return {
    proforma,
    conversion: {
      pending: conversionPending, error: issuance.error ?? draftCreation.error ?? series.error,
      series: invoiceSeries, selectedSeries: effectiveSeries, selectSeries: setSelectedSeries,
      canCreateDraft: canConvert && effectiveSeries !== "" && !conversionPending,
      canIssueInvoice: canConvert && effectiveSeries !== "" && !conversionPending && !dueDateRequired,
      dueDateIssue: dueDateRequired ? "Proforma are total pozitiv și nu are scadență. Creează un draft și completează scadența înainte de emiterea facturii." : null,
      converted, issueInvoice, createDraft,
    },
    download: { pending: download.isPending, error: download.error, start: download.mutate },
  }
}
