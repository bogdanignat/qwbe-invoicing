import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { useAuth } from "./auth-context.ts"
import {
  efacturaConnectionQuery, efacturaHistoryQuery, invalidateDocumentStatus, invalidateEFacturaDocument,
} from "./efactura-queries.ts"
import { retryAction } from "./use-document-detail.ts"
import { useEFacturaFiles, type EFacturaFilesModel } from "./use-efactura-files.ts"
import { useEFacturaReconciliation, type EFacturaReconciliationModel } from "./use-efactura-reconciliation.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { SESSION_CLOSED } from "./use-registry-writes.ts"
import { panelView, type ConnectionRead, type EFacturaPanelView } from "../lib/efactura-document.ts"
import { efacturaFailure } from "../lib/efactura-feedback.ts"
import { historyRows, type SubmissionRow } from "../lib/efactura-history.ts"
import type { SubmittedKind } from "../lib/efactura-submissions.ts"
import { pluginActive } from "../lib/plugins.ts"
import { sessionWrite } from "../lib/session-write.ts"

export interface EFacturaDocumentModel {
  readonly view: EFacturaPanelView | undefined
  readonly rows: ReadonlyArray<SubmissionRow>
  readonly isPending: boolean
  readonly error: Error | undefined
  readonly retry: (() => void) | undefined
  /** The connection could not be read and nothing cached decides it: why, and a retry when it may pass. */
  readonly connectionError: Error | undefined
  readonly connectionRetry: (() => void) | undefined
  readonly notice: string | undefined
  readonly pending: boolean
  readonly failure: Error | undefined
  readonly submit: () => void
  readonly files: EFacturaFilesModel
  readonly reconciliation: EFacturaReconciliationModel
}

export const SUBMITTED_NOTICE = "Documentul a fost pus la coadă pentru ANAF. Starea se actualizează singură."

/**
 * The e-Factura panel of an issued invoice or a correction: the submission
 * history (polled while ANAF works on it), the connection that decides whether
 * the document can be sent, and the one write that sends it. Sending is manual:
 * nothing here submits on its own. When the document's status moves — by a
 * write or by the polling — its head and the register are refreshed with it.
 * With the plugin off nothing is read and there is no model.
 */
export const useEFacturaDocument = (
  kind: SubmittedKind, id: string, document: { readonly series: string; readonly number: number } | undefined,
): EFacturaDocumentModel | undefined => {
  const auth = useAuth()
  const enabled = pluginActive(auth, "efactura")
  const { efactura } = useInvoicingClients()
  const queryClient = useQueryClient()
  const history = useQuery(efacturaHistoryQuery(efactura, kind, id, enabled))
  const connection = useQuery(efacturaConnectionQuery(efactura, enabled))
  const connectionRead: ConnectionRead = connection.data?.status ?? (connection.isPending ? "loading" : "unreadable")
  const view = history.data === undefined ? undefined : panelView(kind, history.data, connectionRead)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const inFlight = useRef(false)
  const refresh = (): void => { invalidateEFacturaDocument(queryClient, kind, id) }

  const seen = useRef(view?.status)
  const status = view?.status
  useEffect(() => {
    if (status === undefined) return
    if (seen.current !== undefined && seen.current !== status) invalidateDocumentStatus(queryClient, kind, id)
    seen.current = status
  }, [status, kind, id, queryClient])

  const submit = useMutation({
    mutationFn: async () => (await sessionWrite(auth, (token) => efactura.submit(token, kind, id), SESSION_CLOSED))?.value,
    onSuccess: (submitted) => { if (submitted !== undefined) { setNotice(SUBMITTED_NOTICE); refresh() } },
    onError: refresh,
    onSettled: () => { inFlight.current = false },
  })
  const files = useEFacturaFiles(efactura, { prefix: kind === "invoice" ? "factura" : "storno", document })
  const unknownId = view?.reconcile === true ? view.current?.id : undefined
  const reconciliation = useEFacturaReconciliation(efactura, unknownId, () => { setNotice(undefined); refresh() })

  if (!enabled) return undefined
  return {
    view,
    rows: history.data === undefined ? [] : historyRows(history.data),
    isPending: history.isPending,
    error: history.data === undefined ? efacturaFailure(history.error) : undefined,
    retry: retryAction(history.error, () => { void history.refetch() }),
    connectionError: connection.data === undefined ? efacturaFailure(connection.error) : undefined,
    connectionRetry: retryAction(connection.error, () => { void connection.refetch() }),
    notice,
    pending: submit.isPending || reconciliation.pending,
    failure: efacturaFailure(submit.error),
    submit: () => {
      if (inFlight.current || view?.canSubmit !== true) return
      inFlight.current = true
      setNotice(undefined)
      submit.mutate()
    },
    files,
    reconciliation,
  }
}
