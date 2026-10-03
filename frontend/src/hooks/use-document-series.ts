"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { registryLoad, registryReload, type RegistryLoad } from "../lib/registry-load.ts"
import { registryWriteOutcome } from "../lib/registry-write-outcome.ts"
import { requireCsrf } from "../lib/require-csrf.ts"
import {
  documentSeriesNotice, documentSeriesPayload, newDocumentSeriesForm,
  type DocumentSeriesField, type DocumentSeriesForm,
} from "../lib/document-series-form.ts"
import type { DocumentSeries } from "../lib/draft-models.ts"
import type { DocumentSeriesInput } from "../lib/settings-client.ts"
import type { RegistryEditorIssue } from "./use-registry-editor.ts"

/**
 * The series card: the configured series and the single add.
 *
 * Configuring a series is add-only, so there is no editor state to keep — one
 * form, cleared after the series it created is in the list. The alphabet and the
 * duplicate check are `document-series-form.ts`; the ownership filter is the
 * same `registryWriteOutcome` the master-data writes use, so an answer that
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
  readonly change: (patch: Partial<DocumentSeriesForm>) => void
  readonly submit: () => void
}

export const useDocumentSeries = (): DocumentSeriesModel => {
  const { status, csrfToken, epoch, ownsEpoch } = useAuth()
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const list = useQuery({
    queryKey: ["document-series"],
    enabled: status === "authenticated",
    queryFn: ({ signal }) => clients.reference.listDocumentSeries(signal),
  })
  const [form, setForm] = useState<DocumentSeriesForm>(newDocumentSeriesForm)
  const [issue, setIssue] = useState<RegistryEditorIssue<DocumentSeriesField> | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const add = useMutation({
    mutationFn: async (request: { readonly payload: DocumentSeriesInput }) => {
      const token = requireCsrf(csrfToken())
      const session = epoch()
      let created: DocumentSeries | undefined
      const owned = await registryWriteOutcome(
        request,
        async () => {
          created = await clients.settings.createDocumentSeries(token, request.payload)
        },
        () => ownsEpoch(session),
      )
      return owned === undefined ? undefined : created
    },
    onSuccess: (created) => {
      if (created === undefined) return
      void queryClient.invalidateQueries({ queryKey: ["document-series"] })
      setNotice(documentSeriesNotice(created))
      setForm(newDocumentSeriesForm())
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
  }
}
