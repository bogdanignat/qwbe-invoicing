import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { runUiEffect } from "../lib/api.ts"
import { issuerAddressSelection } from "../lib/issuer-address-state.ts"
import type { FormSubmitEvent } from "../lib/form.ts"
import { today } from "../lib/format.ts"
import { invoicingClient, type IssuerInput } from "../lib/invoicing-client.ts"
import { brandingImageSaveIssue, createRevisionGuard } from "../lib/issuer-branding.ts"
import { vatSettingsSelection, vatSettingsStatus } from "../lib/issuer-settings-state.ts"
import { fallbackVatRegistration, normalizeRomanianCui, vatRegistrationHistory } from "../lib/vat-defaults.ts"
import { useVatCatalogue } from "./vat-hooks.ts"
import { countyRequiresSector } from "../lib/romanian-counties.ts"
import { useIssuerBranding } from "./issuer-branding-hooks.ts"
import { issuerBrandTextFromForm, issuerInputFromForm, issuerLegalDetailsFromForm } from "../lib/issuer-settings-form.ts"

interface VatOverride {
  readonly registered: boolean
  readonly effectiveFrom: string
  readonly status: string
}

export const useIssuerSettings = (notify: (message: string) => void) => {
  const queryClient = useQueryClient()
  const issuerQuery = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const catalogueQuery = useVatCatalogue()
  const [issuerDetailsError, setIssuerDetailsError] = useState<Error | null>(null)
  const [formVersion, setFormVersion] = useState(0)
  const [vatOverride, setVatOverride] = useState<VatOverride>()
  const [countyOverride, setCountyOverride] = useState<string | undefined>()
  const [sectorOverride, setSectorOverride] = useState<number | undefined>()
  const editGuard = useRef(createRevisionGuard())
  const issuer = issuerQuery.data ?? undefined
  const { brandingView, resetBranding, setBrandingError } = useIssuerBranding(
    issuer?.branding ?? null,
    editGuard,
    notify,
  )
  const fallbackVat = issuer?.currentVat == null ? fallbackVatRegistration(issuer?.vatConfigurations ?? [], today()) : undefined
  const savedVat = issuer?.currentVat ?? fallbackVat
  const savedVatSelection = vatSettingsSelection(savedVat, today())
  const vatRegistered = vatOverride?.registered ?? savedVatSelection.registered
  const vatEffectiveFrom = vatOverride?.effectiveFrom ?? savedVatSelection.effectiveFrom
  const { county, sector } = issuerAddressSelection(issuer?.address, countyOverride, sectorOverride)

  const saveIssuer = useMutation({
    mutationFn: ({ input }: { readonly input: IssuerInput; readonly revision: number }) => runUiEffect(invoicingClient.saveIssuer(input)),
    onSuccess: async (saved, variables) => {
      queryClient.setQueryData(["issuer"], saved)
      await queryClient.invalidateQueries({ queryKey: ["issuer"] })
      if (editGuard.current.isCurrent(variables.revision)) {
        resetBranding()
        setIssuerDetailsError(null)
        setVatOverride(undefined)
        setCountyOverride(undefined)
        setSectorOverride(undefined)
        setFormVersion((value) => value + 1)
      }
      notify("Datele firmei au fost salvate.")
    },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const imageIssue = brandingImageSaveIssue(brandingView.pending, brandingView.imageError)
    if (imageIssue !== null) {
      notify(`Datele nu au fost salvate: ${imageIssue}`)
      const imageInput = form.querySelector<HTMLInputElement>("#issuer-brand-image")
      imageInput?.focus()
      imageInput?.scrollIntoView({ block: "center" })
      return
    }
    let brandText: string | null
    try { brandText = issuerBrandTextFromForm(brandingView) } catch (cause) {
      setBrandingError(cause instanceof Error ? cause : new Error("Textul de brand este invalid."))
      return
    }
    let legalDetails
    try { legalDetails = issuerLegalDetailsFromForm(form) } catch (cause) {
      setIssuerDetailsError(cause instanceof Error ? cause : new Error("Datele juridice sunt invalide."))
      return
    }
    setBrandingError(null)
    setIssuerDetailsError(null)
    saveIssuer.mutate({
      revision: editGuard.current.current(),
      input: issuerInputFromForm(form, brandingView, brandText, legalDetails, vatRegistered),
    })
  }

  const fiscalIdentifier = issuer?.fiscalIdentifier ?? ""
  const catalogue = catalogueQuery.data
  const vatHistory = catalogue === undefined || issuer === undefined ? [] : vatRegistrationHistory(issuer.vatConfigurations, catalogue)

  return {
    issuerQuery, catalogueQuery, issuer, formKey: `${issuer?.organizationId ?? "new"}-${String(formVersion)}`,
    fiscalIdentifier, vatRegistered, vatEffectiveFrom, vatHistory, county, sector,
    sectorRequired: countyRequiresSector(county),
    submit,
    save: { pending: saveIssuer.isPending, error: issuerDetailsError ?? saveIssuer.error },
    branding: brandingView,
    normalizeFiscalIdentifier: (input: HTMLInputElement) => {
      input.setCustomValidity("")
      input.value = normalizeRomanianCui(input.value)
    },
    changeCounty: (value: string) => { setCountyOverride(value); setSectorOverride(undefined) },
    changeSector: (value: string) => { setSectorOverride(Number(value)) },
    changeVatRegistration: (registered: boolean) => {
      setVatOverride({ registered, effectiveFrom: today(), status: registered
        ? "Regimul plătitor de TVA a fost ales manual."
        : "Regimul neplătitor de TVA a fost ales manual." })
    },
    changeVatEffectiveFrom: (effectiveFrom: string) => {
      setVatOverride({
        registered: vatRegistered,
        effectiveFrom,
        status: vatOverride?.status ?? "Data schimbării regimului TVA a fost modificată.",
      })
    },
    vatStatus: vatOverride?.status ?? vatSettingsStatus(vatRegistered, fallbackVat),
  }
}
