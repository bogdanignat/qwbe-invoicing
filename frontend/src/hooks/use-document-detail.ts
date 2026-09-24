import { useQuery } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { useDocumentDownload, type DocumentDownloadAction } from "./use-document-download.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { isTransientFailure } from "../lib/api-errors.ts"
import { documentFilename } from "../lib/browser-download.ts"
import { projectCorrectionDocument, projectIssuedInvoice, type DocumentSnapshotView } from "../lib/document-projection.ts"

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
const retryAction = (error: unknown, refetch: () => void): (() => void) | undefined =>
  isTransientFailure(error) ? refetch : undefined

/**
 * Rendering a PDF is a write, so it needs the token that proves the session
 * asked for it. Without one there is nothing to sign the request with and the
 * attempt fails here rather than as an opaque `403` from the API.
 */
const requireCsrf = (csrfToken: string | undefined): string => {
  if (csrfToken === undefined) throw new Error("Sesiunea nu mai poate semna cererea. Reîncarcă pagina.")
  return csrfToken
}

export const useInvoiceDetail = (id: string): DocumentDetailModel => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const query = useQuery({
    queryKey: ["invoice", id],
    enabled: status === "authenticated",
    queryFn: ({ signal }) => clients.documents.getInvoice(id, signal),
  })
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
