import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { runUiEffect } from "./api.ts"
import { formField, type FormSubmitEvent } from "./form.ts"
import { today } from "./format.ts"
import { invoicingClient, type IssuerInput } from "./invoicing-client.ts"
import { beginBrandImageSelection, brandingDraftFromSaved, brandingImageSaveIssue, changeBrandImage, changeBrandText as changeBrandTextInDraft, createRevisionGuard, normalizeBrandText, removeBrandImage as removeBrandImageFromDraft, removeBranding as emptyBrandingDraft, validateBrandingDimensions, validateBrandingFile, validateBrandingFileInfo, type BrandingDraft, type RasterMime } from "./issuer-branding.ts"
import { normalizeIssuerLegalDetails, type IssuerLegalDetails } from "./issuer-details.ts"
import { fallbackVatRegistration, normalizeRomanianCui, shouldApplyVatInference, vatRegistrationHistory } from "./vat-defaults.ts"
import { useVatCatalogue } from "./vat-hooks.ts"

const decodeImageDimensions = async (blob: Blob): Promise<{ readonly width: number; readonly height: number }> => {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob)
    try { return { width: bitmap.width, height: bitmap.height } } finally { bitmap.close() }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve({ width: image.naturalWidth, height: image.naturalHeight }) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Fișierul nu poate fi decodat ca imagine.")) }
    image.src = url
  })
}

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

export const useIssuerSettings = (notify: (message: string) => void) => {
  const queryClient = useQueryClient()
  const issuerQuery = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const catalogueQuery = useVatCatalogue()
  const [brandingOverride, setBrandingOverride] = useState<BrandingDraft | undefined>()
  const [brandingError, setBrandingError] = useState<Error | null>(null)
  const [imageError, setImageError] = useState<Error | null>(null)
  const [issuerDetailsError, setIssuerDetailsError] = useState<Error | null>(null)
  const [imagePending, setImagePending] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const [vatOverride, setVatOverride] = useState<{ readonly registered: boolean; readonly effectiveFrom: string; readonly status: string }>()
  const manualVat = useRef(false)
  const latestFiscalIdentifier = useRef(issuerQuery.data?.fiscalIdentifier ?? "")
  const vatInferenceGuard = useRef(createRevisionGuard())
  const fileGuard = useRef(createRevisionGuard())
  const editGuard = useRef(createRevisionGuard())
  const issuer = issuerQuery.data ?? undefined
  const fallbackVat = issuer?.currentVat == null ? fallbackVatRegistration(issuer?.vatConfigurations ?? [], today()) : undefined
  const savedVat = issuer?.currentVat ?? fallbackVat
  const vatRegistered = vatOverride?.registered ?? savedVat?.registered ?? true
  const vatEffectiveFrom = vatOverride?.effectiveFrom ?? savedVat?.effectiveFrom ?? today()
  const branding = brandingOverride ?? brandingDraftFromSaved(issuer?.branding ?? null)

  const saveIssuer = useMutation({
    mutationFn: ({ input }: { readonly input: IssuerInput; readonly revision: number }) => runUiEffect(invoicingClient.saveIssuer(input)),
    onSuccess: async (saved, variables) => {
      queryClient.setQueryData(["issuer"], saved)
      await queryClient.invalidateQueries({ queryKey: ["issuer"] })
      if (editGuard.current.isCurrent(variables.revision)) {
        fileGuard.current.invalidate()
        vatInferenceGuard.current.invalidate()
        setBrandingOverride(undefined)
        setBrandingError(null)
        setImageError(null)
        setIssuerDetailsError(null)
        setVatOverride(undefined)
        manualVat.current = false
        setFormVersion((value) => value + 1)
      }
      notify("Datele firmei au fost salvate.")
    },
  })
  const inferVatRegistration = useMutation({
    mutationFn: ({ inference }: { readonly inference: { readonly countryCode: string; readonly fiscalIdentifier: string }; readonly revision: number }) =>
      runUiEffect(invoicingClient.getVatCatalogue(inference)),
    onSuccess: ({ inferredRegistration }, { inference, revision }) => {
      if (inferredRegistration === null || !shouldApplyVatInference({
        requestedFiscalIdentifier: inference.fiscalIdentifier,
        currentFiscalIdentifier: latestFiscalIdentifier.current,
        requestIsCurrent: vatInferenceGuard.current.isCurrent(revision),
        manuallySelectedVat: manualVat.current,
      })) return
      setVatOverride({
        registered: inferredRegistration, effectiveFrom: today(),
        status: inferredRegistration
          ? "Prefix RO detectat: regimul plătitor de TVA este propus; îl poți schimba manual."
          : "CUI fără prefix RO: regimul neplătitor de TVA este propus; îl poți schimba manual.",
      })
    },
  })

  const changeBrandText = (text: string): void => {
    editGuard.current.invalidate()
    setBrandingOverride((current) => changeBrandTextInDraft(current ?? brandingDraftFromSaved(issuer?.branding ?? null), text))
    setBrandingError(null)
  }

  const selectBrandImage = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return
    const selection = beginBrandImageSelection(fileGuard.current, editGuard.current)
    setImagePending(true)
    setImageError(null)
    try {
      validateBrandingFileInfo(file.type, file.size)
      const bytes = new Uint8Array(await file.arrayBuffer())
      const mime: RasterMime = validateBrandingFile(file.type, Math.max(file.size, bytes.byteLength), bytes)
      const dimensions = await decodeImageDimensions(new Blob([bytes], { type: mime }))
      validateBrandingDimensions(dimensions.width, dimensions.height)
      if (!fileGuard.current.isCurrent(selection)) return
      const dataBase64 = bytesToBase64(bytes)
      editGuard.current.invalidate()
      setBrandingOverride((current) => changeBrandImage(current ?? brandingDraftFromSaved(issuer?.branding ?? null), {
        dataBase64,
        previewUrl: `data:${mime};base64,${dataBase64}`,
        width: dimensions.width,
        height: dimensions.height,
      }))
    } catch (cause) {
      if (fileGuard.current.isCurrent(selection)) {
        const error = cause instanceof Error ? cause : new Error("Imaginea nu a putut fi citită.")
        setImageError(error)
        notify(`Sigla nu a fost încărcată: ${error.message}`)
      }
    } finally {
      if (fileGuard.current.isCurrent(selection)) setImagePending(false)
    }
  }

  const removeBrandImage = (): void => {
    fileGuard.current.invalidate()
    editGuard.current.invalidate()
    setImagePending(false)
    setBrandingError(null)
    setImageError(null)
    setBrandingOverride((current) => removeBrandImageFromDraft(current ?? brandingDraftFromSaved(issuer?.branding ?? null)))
  }

  const discardRejectedImage = (): void => {
    setImageError(null)
  }

  const removeBranding = (): void => {
    fileGuard.current.invalidate()
    editGuard.current.invalidate()
    setImagePending(false)
    setBrandingError(null)
    setImageError(null)
    setBrandingOverride(emptyBrandingDraft())
  }

  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const imageIssue = brandingImageSaveIssue(imagePending, imageError)
    if (imageIssue !== null) {
      notify(`Datele nu au fost salvate: ${imageIssue}`)
      const imageInput = form.querySelector<HTMLInputElement>("#issuer-brand-image")
      imageInput?.focus()
      imageInput?.scrollIntoView({ block: "center" })
      return
    }
    const county = formField(form, "county")
    const postalCode = formField(form, "postalCode")
    const countryCode = "RO"
    const fiscalIdentifier = formField(form, "fiscalIdentifier")
    let brandText: string | null
    try { brandText = normalizeBrandText(branding.text) } catch (cause) {
      setBrandingError(cause instanceof Error ? cause : new Error("Textul de brand este invalid."))
      return
    }
    let legalDetails: IssuerLegalDetails
    try {
      legalDetails = normalizeIssuerLegalDetails({
        legalForm: formField(form, "legalForm"), tradeRegistryNumber: formField(form, "tradeRegistryNumber"),
        iban: formField(form, "iban"), bankName: formField(form, "bankName"), socialCapital: formField(form, "socialCapital"),
      })
    } catch (cause) {
      setIssuerDetailsError(cause instanceof Error ? cause : new Error("Datele juridice sunt invalide."))
      return
    }
    const image = branding.image
    setBrandingError(null)
    setIssuerDetailsError(null)
    saveIssuer.mutate({
      revision: editGuard.current.current(),
      input: {
        name: formField(form, "name"), fiscalIdentifier,
        address: { countryCode, city: formField(form, "city"), street: formField(form, "street"), ...(county === "" ? {} : { county }), ...(postalCode === "" ? {} : { postalCode }) },
        ...legalDetails,
        defaultCurrency: "RON", defaultPaymentTermDays: Number(formField(form, "defaultPaymentTermDays")),
        vatChange: { registered: vatRegistered, effectiveFrom: formField(form, "taxEffectiveFrom") },
        branding: brandText === null && image === null ? null : { text: brandText, image: image === null ? null : { dataBase64: image.dataBase64 } },
      },
    })
  }

  const fiscalIdentifier = issuer?.fiscalIdentifier ?? ""
  const catalogue = catalogueQuery.data
  const vatHistory = catalogue === undefined || issuer === undefined ? [] : vatRegistrationHistory(issuer.vatConfigurations, catalogue)

  return {
    issuerQuery, catalogueQuery, issuer, formKey: `${issuer?.organizationId ?? "new"}-${String(formVersion)}`,
    fiscalIdentifier, vatRegistered, vatEffectiveFrom, vatHistory,
    submit,
    save: { pending: saveIssuer.isPending, error: issuerDetailsError ?? saveIssuer.error }, vatInferenceError: inferVatRegistration.error,
    branding: { ...branding, error: brandingError, imageError, discardRejectedImage, pending: imagePending, changeText: changeBrandText, selectImage: selectBrandImage, removeImage: removeBrandImage, removeAll: removeBranding },
    normalizeFiscalIdentifier: (input: HTMLInputElement) => {
      input.setCustomValidity("")
      input.value = normalizeRomanianCui(input.value)
      latestFiscalIdentifier.current = input.value
      vatInferenceGuard.current.invalidate()
    },
    inferVat: (input: HTMLInputElement) => {
      if (input.form === null) return
      latestFiscalIdentifier.current = input.value
      inferVatRegistration.mutate({
        inference: { countryCode: formField(input.form, "countryCode"), fiscalIdentifier: input.value },
        revision: vatInferenceGuard.current.begin(),
      })
    },
    changeVatRegistration: (registered: boolean) => {
      manualVat.current = true
      vatInferenceGuard.current.invalidate()
      setVatOverride({ registered, effectiveFrom: today(), status: registered
        ? "Regimul plătitor de TVA a fost ales manual."
        : "Regimul neplătitor de TVA a fost ales manual." })
    },
    changeVatEffectiveFrom: (effectiveFrom: string) => {
      manualVat.current = true
      vatInferenceGuard.current.invalidate()
      setVatOverride({ registered: vatRegistered, effectiveFrom, status: vatOverride?.status ?? "Data schimbării regimului TVA a fost modificată." })
    },
    vatStatus: vatOverride?.status ?? (fallbackVat?.timing === "scheduled"
      ? `Regimul ${vatRegistered ? "plătitor" : "neplătitor"} de TVA este programat de la ${fallbackVat.effectiveFrom}.`
      : fallbackVat?.timing === "expired"
        ? `Ultimul regim ${vatRegistered ? "plătitor" : "neplătitor"} de TVA a expirat; alege data unei schimbări pentru reactivare.`
        : vatRegistered ? "Firma este configurată ca plătitoare de TVA." : "Firma este configurată ca neplătitoare de TVA."),
  }
}
