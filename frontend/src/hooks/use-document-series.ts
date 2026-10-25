import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { documentSeriesQuery, referenceQueryKeys } from "./reference-queries.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { registryLoad, registryReload, type RegistryLoad } from "../lib/registry-load.ts"
import { sessionWrite } from "../lib/session-write.ts"
import {
  documentSeriesNotice, documentSeriesPayload, newDocumentSeriesForm,
  type DocumentSeriesField, type DocumentSeriesForm,
} from "../lib/document-series-form.ts"
import { archiveNotice, seriesKey } from "../lib/document-series-archive.ts"
import type { DocumentSeries } from "../lib/draft-models.ts"
import type { DocumentSeriesInput } from "../lib/settings-client.ts"
import type { RegistryEditorIssue } from "./use-registry-editor.ts"

/**
 * The series card: the configured series, the single add and the archive
 * toggle on each row.
 *
 * A series is never edited, so there is no editor state to keep — one form,
 * cleared after the series it created is in the list. One archive toggle runs at
 * a time; a click on any row while it is in flight is ignored rather than the
 * button disabled, so the focus stays where the user left it. The alphabet and the
 * duplicate check are `document-series-form.ts`; the ownership filter is the
 * same `sessionWrite` the master-data writes use, so an answer that
 * arrives after the session ended leaves neither a notice nor a refetch behind.
 */
export interface DocumentSeriesModel {
  readonly load: RegistryLoad
  readonly retry: (() => void) | undefined
  readonly series: ReadonlyArray<DocumentSeries>
  readonly form: DocumentSeriesForm
  readonly issue: RegistryEditorIssue<DocumentSeriesField> | undefined
  readonly pending: boolean
  readonly error: unknown
  readonly notice: string | undefined
  /** The `seriesKey` of the row whose toggle is in flight. */
  readonly archiving: string | undefined
  readonly archiveError: unknown
  readonly change: (patch: Partial<DocumentSeriesForm>) => void
  readonly submit: () => void
  readonly toggleArchived: (series: DocumentSeries) => void
}

export const useDocumentSeries = (): DocumentSeriesModel => {
  const auth = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const list = useQuery(documentSeriesQuery(clients.reference, auth.status === "authenticated"))
  const [form, setForm] = useState<DocumentSeriesForm>(newDocumentSeriesForm)
  const [issue, setIssue] = useState<RegistryEditorIssue<DocumentSeriesField> | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const add = useMutation({
    mutationFn: async (request: { readonly payload: DocumentSeriesInput }) => {
      const answer = await sessionWrite(auth, (token) => clients.settings.createDocumentSeries(token, request.payload))
      return answer?.value
    },
    onSuccess: (created) => {
      if (created === undefined) return
      void queryClient.invalidateQueries({ queryKey: referenceQueryKeys.documentSeries })
      setNotice(documentSeriesNotice(created))
      setForm(newDocumentSeriesForm())
    },
  })
  const archive = useMutation({
    mutationFn: async (series: DocumentSeries) => {
      const answer = await sessionWrite(auth, (token) => clients.settings.setDocumentSeriesArchived(token, series, !series.archived))
      return answer?.value
    },
    onSuccess: (updated) => {
      if (updated === undefined) return
      void queryClient.invalidateQueries({ queryKey: referenceQueryKeys.documentSeries })
      setNotice(archiveNotice(updated))
    },
  })
  const load = registryLoad([["series", { data: list.data, isPending: list.isPending, error: list.error }]])
  return {
    load,
    retry: registryReload(load, { series: () => { void list.refetch() } }),
    series: list.data ?? [],
    form,
    issue,
    pending: add.isPending,
    error: add.error,
    notice,
    archiving: archive.isPending ? seriesKey(archive.variables) : undefined,
    archiveError: archive.error,
    change: (patch) => {
      setIssue(undefined)
      setNotice(undefined)
      setForm((current) => ({ ...current, ...patch }))
    },
    submit: () => {
      const validation = documentSeriesPayload(form, list.data ?? [])
      if (validation.kind === "issue") {
        setIssue({ field: validation.field, message: validation.message })
        return
      }
      setIssue(undefined)
      setNotice(undefined)
      add.mutate({ payload: validation.payload })
    },
    toggleArchived: (series) => {
      if (archive.isPending) return
      setNotice(undefined)
      archive.mutate(series)
    },
  }
}
