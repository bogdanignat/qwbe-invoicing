import { queryOptions, useQuery } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { useDocumentDownload, type DocumentDownloadAction } from "./use-document-download.ts"
import { useInvoicingClients, type InvoicingClients } from "./use-invoicing-clients.ts"
import { isTransientFailure } from "../lib/api-errors.ts"
import { documentFilename } from "../lib/browser-download.ts"
import { projectCorrectionDocument, projectIssuedInvoice, type DocumentSnapshotView } from "../lib/document-projection.ts"
import { requireCsrf } from "../lib/require-csrf.ts"

export interface DocumentDetailModel {
  readonly view: DocumentSnapshotView | undefined
  readonly isPending: boolean
  readonly error: unknown
  /** Present only when asking again could plausibly answer differently. */
  readonly retry: (() => void) | undefined
  readonly downloads: ReadonlyArray<DocumentDownloadAction>
}

/**
 * Whether to offer a retry, decided here rather than in the alert.
 *
 * The query client runs with `retry: false`, so nothing asks again on its own;
 * offering the button for a `404` would invite the reader to keep pressing it
 * at a document that does not exist, which is why the classification lives with
 * the model and the component only renders what it is handed.
 */
export const retryAction = (error: unknown, refetch: () => void): (() => void) | undefined =>
  isTransientFailure(error) ? refetch : undefined

/** One definition of the invoice read, shared by the detail and the payments panel that needs its currency. */
export const invoiceQueryOptions = (clients: InvoicingClients, id: string, enabled: boolean) => queryOptions({
  queryKey: ["invoice", id],
  enabled,
  queryFn: ({ signal }) => clients.documents.getInvoice(id, signal),
})

export const useInvoiceDetail = (id: string): DocumentDetailModel => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const query = useQuery(invoiceQueryOptions(clients, id, status === "authenticated"))
  const invoice = query.data
  const pdf = useDocumentDownload({
    key: "pdf",
    label: "Descarcă PDF",
    pendingLabel: "Se generează…",
    request: (csrfToken) => clients.documents.downloadInvoicePdf(id, requireCsrf(csrfToken)),
    filename: invoice === undefined ? undefined : documentFilename("factura", invoice, "pdf"),
  })
  const efactura = useDocumentDownload({
    key: "efactura",
    label: "Descarcă XML e-Factura",
    pendingLabel: "Se generează…",
    request: () => clients.documents.downloadInvoiceEFactura(id),
    filename: invoice === undefined ? undefined : documentFilename("efactura", invoice, "xml"),
  })
  return {
    view: invoice === undefined ? undefined : projectIssuedInvoice(invoice),
    isPending: query.isPending,
    error: query.error,
    retry: retryAction(query.error, () => { void query.refetch() }),
    downloads: [pdf, efactura],
  }
}

/**
 * A correction offers only its XML.
 *
 * The backend renders no PDF for one — `/api/corrections/{id}` and
 * `/api/corrections/{id}/efactura.xml` are the whole surface — so the screen
 * offers nothing that would 404.
 */
export const useCorrectionDetail = (id: string): DocumentDetailModel => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const query = useQuery({
    queryKey: ["correction", id],
    enabled: status === "authenticated",
    queryFn: ({ signal }) => clients.documents.getCorrection(id, signal),
  })
  const correction = query.data
  const efactura = useDocumentDownload({
    key: "efactura",
    label: "Descarcă XML e-Factura",
    pendingLabel: "Se generează…",
    request: () => clients.documents.downloadCorrectionEFactura(id),
    filename: correction === undefined ? undefined : documentFilename("efactura-storno", correction, "xml"),
  })
  return {
    view: correction === undefined ? undefined : projectCorrectionDocument(correction),
    isPending: query.isPending,
    error: query.error,
    retry: retryAction(query.error, () => { void query.refetch() }),
    downloads: [efactura],
  }
}
