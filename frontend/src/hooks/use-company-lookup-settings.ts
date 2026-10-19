"use client"

import { queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { companyLookupQueryKeys, type CompanyLookupClient } from "../lib/company-lookup-client.ts"
import { companyLookupFailureMessage, integrationsLoad, type IntegrationsLoad } from "../lib/company-lookup-feedback.ts"
import {
  EMPTY_KEY_FIELD, keyClear, keyClearConfirm, keyFieldAfterSave, keySave, providerToggle,
  type CompanyLookupSettings, type KeyField, type SettingsChange, type SwitchableProvider,
} from "../lib/company-lookup-settings.ts"
import { pluginActive } from "../lib/plugins.ts"
import { sessionWrite } from "../lib/session-write.ts"

/**
 * Setări → Integrări: the stored settings, the one write, and the key draft.
 *
 * Every rule is `lib/company-lookup-settings.ts`; this hook only sends what a
 * rule decided. Nothing is optimistic: the switches show the backend's answer,
 * so a refused write leaves them where they were. With the plugin off the read
 * is never enabled and the model says `off`.
 */
export interface OpenapiKeyEditor {
  readonly draft: string
  /** The field is open: no key stored yet, or one being replaced. */
  readonly editing: boolean
  readonly replacing: boolean
  readonly change: (value: string) => void
  readonly startReplace: () => void
  readonly cancelReplace: () => void
  readonly save: () => void
  readonly clear: () => void
}

export interface CompanyLookupSettingsModel {
  readonly load: IntegrationsLoad
  readonly retry: (() => void) | undefined
  readonly pending: boolean
  /** A local refusal or the backend's, already in Romanian. */
  readonly failure: string | undefined
  readonly notice: string | undefined
  readonly toggle: (provider: SwitchableProvider, on: boolean) => void
  readonly key: OpenapiKeyEditor
}

type Save = Extract<SettingsChange, { readonly kind: "save" }>

/** The read, apart so a test can subscribe to it and count what it fetches. */
export const companyLookupSettingsQuery = (client: CompanyLookupClient, enabled: boolean) => queryOptions({
  queryKey: companyLookupQueryKeys.settings,
  enabled,
  queryFn: ({ signal }) => client.getSettings(signal),
})

/** The saved answer becomes the read, and the forms re-ask what they may look up. */
export const adoptSavedSettings = (queryClient: QueryClient, saved: CompanyLookupSettings): void => {
  queryClient.setQueryData(companyLookupQueryKeys.settings, saved)
  void queryClient.invalidateQueries({ queryKey: companyLookupQueryKeys.availability })
}

export const useCompanyLookupSettings = (): CompanyLookupSettingsModel => {
  const auth = useAuth()
  const enabled = pluginActive(auth, "company-lookup")
  const clients = useInvoicingClients()
  const queryClient = useQueryClient()
  const read = useQuery(companyLookupSettingsQuery(clients.companyLookup, enabled))
  const [keyField, setKeyField] = useState<KeyField>(EMPTY_KEY_FIELD)
  const [issue, setIssue] = useState<string | undefined>(undefined)
  const [notice, setNotice] = useState<string | undefined>(undefined)

  // The variables carry the key: `gcTime: 0` drops the settled mutation from the
  // cache, and the answer keeps only what `onSuccess` needs, never the input.
  const write = useMutation({
    gcTime: 0,
    mutationFn: async (change: Save) => {
      const answer = await sessionWrite(auth, (token) => clients.companyLookup.saveSettings(token, change.input))
      return answer === undefined ? undefined : { saved: answer.value, target: change.target, notice: change.notice }
    },
    onSuccess: (outcome) => {
      if (outcome === undefined) return
      adoptSavedSettings(queryClient, outcome.saved)
      setNotice(outcome.notice)
      setKeyField((field) => keyFieldAfterSave(field, outcome.target))
    },
    onError: () => { setKeyField((field) => keyFieldAfterSave(field, "failed")) },
  })

  const load = integrationsLoad(enabled, { data: read.data, isPending: read.isPending, error: read.error })
  const settings = load.kind === "ready" ? load.settings : undefined
  const apply = (decide: (current: CompanyLookupSettings) => SettingsChange): void => {
    if (settings === undefined || write.isPending) return
    const change = decide(settings)
    setIssue(undefined)
    setNotice(undefined)
    write.reset()
    if (change.kind === "issue") setIssue(change.message)
    if (change.kind === "save") write.mutate(change)
  }

  return {
    load,
    retry: load.kind === "error" && load.transient ? () => { void read.refetch() } : undefined,
    pending: write.isPending,
    failure: issue ?? (write.error === null ? undefined : companyLookupFailureMessage(write.error)),
    notice,
    toggle: (provider, on) => { apply((current) => providerToggle(current, provider, on)) },
    key: {
      draft: keyField.draft,
      editing: settings?.openapiKeyConfigured !== true || keyField.replacing,
      replacing: keyField.replacing,
      // The field is disabled while a write is in flight, so the reset never drops a pending one.
      change: (value) => { setIssue(undefined); write.reset(); setKeyField((field) => ({ ...field, draft: value })) },
      startReplace: () => { setNotice(undefined); setKeyField({ draft: "", replacing: true }) },
      cancelReplace: () => { setIssue(undefined); write.reset(); setKeyField(EMPTY_KEY_FIELD) },
      save: () => { apply((current) => keySave(current, keyField.draft)) },
      clear: () => {
        if (settings === undefined || !window.confirm(keyClearConfirm(settings))) return
        apply(keyClear)
      },
    },
  }
}
