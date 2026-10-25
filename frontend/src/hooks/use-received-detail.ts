import { useQuery } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { receivedDetailQuery } from "./received-queries.ts"
import { retryAction } from "./use-document-detail.ts"
import { useDocumentDownload, type DocumentDownloadAction } from "./use-document-download.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { efacturaFailure } from "../lib/efactura-feedback.ts"
import { pluginActive } from "../lib/plugins.ts"
import { projectReceivedDocument, type ReceivedDocumentView } from "../lib/received-detail-projection.ts"
import { unreadableText } from "../lib/received-projection.ts"

export interface ReceivedDetailModel {
  /** A read invoice, ready to render. */
  readonly view: ReceivedDocumentView | undefined
  /** Why an unreadable one could not be read; its ZIP downloads all the same. */
  readonly unreadable: string | undefined
  readonly loaded: boolean
  readonly isPending: boolean
  readonly error: Error | undefined
  readonly retry: (() => void) | undefined
  readonly archive: DocumentDownloadAction
}

/** One received invoice and „Descarcă ZIP”, ANAF's archive as it came; no model with the plugin off. */
export const useReceivedDetail = (id: string): ReceivedDetailModel | undefined => {
  const auth = useAuth()
  const enabled = pluginActive(auth, "efactura")
  const { efacturaReceived } = useInvoicingClients()
  const query = useQuery(receivedDetailQuery(efacturaReceived, id, enabled))
  const detail = query.data
  const archive = useDocumentDownload({
    key: "zip",
    label: "Descarcă ZIP",
    pendingLabel: "Se descarcă…",
    request: () => efacturaReceived.archive(id),
    filename: detail === undefined ? undefined : `efactura-primita-${detail.messageId}.zip`,
  })
  if (!enabled) return undefined
  return {
    view: detail?.readable === true ? projectReceivedDocument(detail) : undefined,
    unreadable: detail?.readable === false ? unreadableText(detail.reason) : undefined,
    loaded: detail !== undefined,
    isPending: query.isPending,
    error: efacturaFailure(query.error),
    retry: retryAction(query.error, () => { void query.refetch() }),
    archive,
  }
}
