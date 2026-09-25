"use client"

import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { useAuth } from "./auth-context.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { brandingActions, useIssuerBranding, type IssuerBrandingModel } from "./use-issuer-branding.ts"
import { useIssuerSave } from "./use-issuer-save.ts"
import { ORGANIZATION_TIME_ZONE, todayIn } from "../lib/format.ts"
import { brandingImageSaveIssue } from "../lib/issuer-branding.ts"
import { focusRegistryField } from "../lib/focus.ts"
import { ISSUER_FORM } from "../lib/registry-fields.ts"
import { createRevisionGuard } from "../lib/revision-guard.ts"
import { registryLoad, registryReload, type RegistryLoad } from "../lib/registry-load.ts"
import {
  changeIssuerIdentifier, changeVatRegistration, chooseIssuerCounty, editedIssuerForm,
  issuerFormOf, issuerSectorRequired, vatSelectionOf, type IssuerSettingsForm,
} from "../lib/issuer-form.ts"
import { issuerPayload, type IssuerField } from "../lib/issuer-payload.ts"
import { issuerVatBaseline, issuerVatStatus, issuerVatSubmitIssue } from "../lib/issuer-vat-baseline.ts"
import { vatRegistrationHistory, type VatHistoryItem } from "../lib/issuer-vat-regime.ts"
import type { RegistryEditorIssue } from "./use-registry-editor.ts"

/**
 * The issuer profile screen: what is saved, what is typed over it, and the one
 * write between them.
 *
 * The form is data rather than a DOM the submit reads back, so the reset after a
 * save is a value — and whether it happens at all is the revision guard's
 * answer, not a timing accident. Every rule lives in `lib`: which regime the
 * profile is in when `currentVat` covers nothing (`issuer-vat-regime.ts`), what
 * the form becomes (`issuer-payload.ts`), what the status line says
 * (`issuer-settings-state.ts`), and which late answers survive
 * (`settings-revisions.ts`).
 *
 * A profile that has never been saved answers `404`, which the reference client
 * turns into `null`: that is a state the form opens on, not a failure.
 */
export interface IssuerSettingsModel {
  readonly load: RegistryLoad
  readonly retry: (() => void) | undefined
  readonly form: IssuerSettingsForm
  readonly sectorRequired: boolean
  readonly issue: RegistryEditorIssue<IssuerField> | undefined
  readonly vatStatus: string
  /** Read-only: the regime is moved by the form, never by editing a past period. */
  readonly vatHistory: ReadonlyArray<VatHistoryItem>
  readonly branding: IssuerBrandingModel
  readonly pending: boolean
  readonly error: unknown
  readonly notice: string | undefined
  readonly change: (patch: Partial<IssuerSettingsForm>) => void
  readonly changeIdentifier: (value: string) => void
  readonly changeCounty: (county: string) => void
  readonly changeVatRegistered: (registered: boolean) => void
  /** Text and logo dropped together, which is how the legacy screen offered it. */
  readonly clearBranding: () => void
  readonly submit: () => void
}

export const useIssuerSettings = (): IssuerSettingsModel => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const enabled = status === "authenticated"
  const issuerQuery = useQuery({
    queryKey: ["issuer"], enabled, queryFn: ({ signal }) => clients.reference.getIssuer(signal),
  })
  const vatQuery = useQuery({
    queryKey: ["vat-regimes"], enabled, queryFn: ({ signal }) => clients.reference.getVatCatalogue(signal),
  })
  const [override, setOverride] = useState<IssuerSettingsForm | undefined>(undefined)
  const [issue, setIssue] = useState<RegistryEditorIssue<IssuerField> | undefined>(undefined)
  // A `useRef` would be the same object, but reading `.current` while rendering
  // is exactly what the ref rule forbids, and the guard has to be handed to the
  // two hooks below during render. `useState` keeps the one instance and makes
  // it a plain value.
  const [editGuard] = useState(createRevisionGuard)
  // Whether the VAT checkbox was answered during this edit. It is the only thing
  // that unlocks the save on a profile whose stored regime cannot be read.
  const [vatChosen, setVatChosen] = useState(false)
  const issuer = issuerQuery.data ?? null
  const editedBranding = useIssuerBranding(issuer?.branding ?? null, editGuard)

  // The regime is read against the date in Bucharest, and derived from the stored
  // configurations rather than the server's cached `currentVat`: one day, one
  // answer, on both ends (`issuer-vat-baseline.ts`).
  const today = todayIn(ORGANIZATION_TIME_ZONE)
  const baseline = issuerVatBaseline(issuer, today)
  const form = override ?? issuerFormOf(issuer, baseline.selection)

  const save = useIssuerSave(editGuard, () => {
    setOverride(undefined)
    setIssue(undefined)
    setVatChosen(false)
    editedBranding.reset()
  })
  const branding = brandingActions(editedBranding, (action) => {
    setIssue(undefined)
    save.dismissNotice()
    // "Elimină sigla" and "Renunță la fișierul respins" unmount themselves; the
    // keyboard would land on `document.body` and have to walk the fieldset again.
    if (action !== "select") focusRegistryField(ISSUER_FORM, "brandImage")
  })

  const edit = (next: (current: IssuerSettingsForm) => IssuerSettingsForm): void => {
    editGuard.invalidate()
    // Typing answers the refusal: the message goes with the keystroke that may
    // have fixed it, instead of outliving the field it pointed at.
    setIssue(undefined)
    save.dismissNotice()
    // The base is the queued form, not the one this render captured: several
    // `onChange` in one batch (an autofilled address) must fold onto each other
    // instead of each starting from the saved profile, as `use-document-series.ts`
    // already does with `setForm((current) => ...)`.
    setOverride((current) => editedIssuerForm(current, issuerFormOf(issuer, baseline.selection), next))
  }

  const submit = (): void => {
    const imageIssue = brandingImageSaveIssue(branding.pending, branding.imageIssue)
    if (imageIssue !== undefined) { setIssue({ field: "brandImage", message: imageIssue }); return }
    const vatIssue = issuerVatSubmitIssue(baseline, vatChosen)
    if (vatIssue !== undefined) { setIssue({ field: "vatRegistered", message: vatIssue }); return }
    const validation = issuerPayload(form, branding.image)
    if (validation.kind === "issue") {
      setIssue({ field: validation.field, message: validation.message })
      return
    }
    setIssue(undefined)
    save.save(validation.payload, editGuard.current())
  }

  const load = registryLoad([
    ["issuer", { data: issuerQuery.data, isPending: issuerQuery.isPending, error: issuerQuery.error }],
    ["vat", { data: vatQuery.data, isPending: vatQuery.isPending, error: vatQuery.error }],
  ])
  return {
    load,
    retry: registryReload(load, {
      issuer: () => { void issuerQuery.refetch() },
      vat: () => { void vatQuery.refetch() },
    }),
    form,
    sectorRequired: issuerSectorRequired(form),
    issue,
    vatStatus: issuerVatStatus(baseline, vatSelectionOf(form), vatChosen),
    vatHistory: vatQuery.data === undefined || issuer === null
      ? []
      : vatRegistrationHistory(issuer.vatConfigurations, vatQuery.data),
    branding,
    pending: save.pending,
    error: save.error,
    notice: save.notice,
    change: (patch) => { edit((current) => ({ ...current, ...patch })) },
    changeIdentifier: (value) => { edit((current) => changeIssuerIdentifier(current, value)) },
    changeCounty: (county) => { edit((current) => chooseIssuerCounty(current, county)) },
    changeVatRegistered: (registered) => {
      setVatChosen(true)
      edit((current) => changeVatRegistration(current, registered, today))
    },
    clearBranding: () => {
      branding.remove()
      edit((current) => ({ ...current, brandText: "" }))
    },
    submit,
  }
}
