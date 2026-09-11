import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useRef, useState } from "react"

import { runUiEffect } from "./api.ts"
import { formField, type FormSubmitEvent } from "./form.ts"
import { today } from "./format.ts"
import { invoicingClient, type IssuerInput } from "./invoicing-client.ts"
import { beginBrandImageSelection, brandingDraftFromSaved, changeBrandImage, changeBrandText as changeBrandTextInDraft, createRevisionGuard, normalizeBrandText, removeBrandImage as removeBrandImageFromDraft, removeBranding as emptyBrandingDraft, validateBrandingDimensions, validateBrandingFile, validateBrandingFileInfo, type BrandingDraft, type RasterMime } from "./issuer-branding.ts"
import { inferRomanianVatDefaults, isNonVat, nearestConfiguredVat, normalizeRomanianCui, resolveVatValues, updateVatTimeline, vatRegistrationMismatch, vatTimelineMismatch, type VatValues } from "./vat-defaults.ts"

const updateVatMismatch = (form: HTMLFormElement, registered: boolean): void => {
  const message = vatRegistrationMismatch(formField(form, "countryCode"), formField(form, "fiscalIdentifier"), registered)
  const fiscalIdentifier = form.elements.namedItem("fiscalIdentifier")
  if (fiscalIdentifier instanceof HTMLInputElement) fiscalIdentifier.setCustomValidity(message ?? "")
  const mismatch = form.querySelector<HTMLElement>("#vat-mismatch")
  if (mismatch !== null) {
    mismatch.hidden = message === undefined
    if (message !== undefined) mismatch.textContent = message
  }
}

const updateVatFields = (form: HTMLFormElement, registered: boolean, message: string): void => {
  const code = form.elements.namedItem("vatRateCode")
  const rate = form.elements.namedItem("vatRate")
  const status = form.elements.namedItem("vatStatus")
  if (!(code instanceof HTMLInputElement) || !(rate instanceof HTMLInputElement)) return
  const resolved = resolveVatValues(registered, { code: code.value.trim(), rate: rate.value.trim() })
  code.value = resolved.code
  rate.value = resolved.rate
  code.readOnly = !registered
  rate.readOnly = !registered
  if (status instanceof HTMLOutputElement) status.value = message
  updateVatMismatch(form, registered)
}

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
  const [brandingOverride, setBrandingOverride] = useState<BrandingDraft | undefined>()
  const [brandingError, setBrandingError] = useState<Error | null>(null)
  const [imagePending, setImagePending] = useState(false)
  const [formVersion, setFormVersion] = useState(0)
  const fileGuard = useRef(createRevisionGuard())
  const editGuard = useRef(createRevisionGuard())
  const issuer = issuerQuery.data ?? undefined
  const branding = brandingOverride ?? brandingDraftFromSaved(issuer?.branding ?? null)

  const saveIssuer = useMutation({
    mutationFn: ({ input }: { readonly input: IssuerInput; readonly revision: number }) => runUiEffect(invoicingClient.saveIssuer(input)),
    onSuccess: (saved, variables) => {
      queryClient.setQueryData(["issuer"], saved)
      if (editGuard.current.isCurrent(variables.revision)) {
        fileGuard.current.invalidate()
        setBrandingOverride(undefined)
        setBrandingError(null)
        setFormVersion((value) => value + 1)
      }
      notify("Datele firmei au fost salvate.")
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
    setBrandingError(null)
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
      if (fileGuard.current.isCurrent(selection)) setBrandingError(cause instanceof Error ? cause : new Error("Imaginea nu a putut fi citită."))
    } finally {
      if (fileGuard.current.isCurrent(selection)) setImagePending(false)
    }
  }

  const removeBrandImage = (): void => {
    fileGuard.current.invalidate()
    editGuard.current.invalidate()
    setImagePending(false)
    setBrandingError(null)
    setBrandingOverride((current) => removeBrandImageFromDraft(current ?? brandingDraftFromSaved(issuer?.branding ?? null)))
  }

  const removeBranding = (): void => {
    fileGuard.current.invalidate()
    editGuard.current.invalidate()
    setImagePending(false)
    setBrandingError(null)
    setBrandingOverride(emptyBrandingDraft())
  }

  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    if (imagePending) { setBrandingError(new Error("Așteaptă validarea imaginii înainte de salvare.")); return }
    const form = event.currentTarget
    const county = formField(form, "county")
    const postalCode = formField(form, "postalCode")
    const countryCode = "RO"
    const fiscalIdentifier = formField(form, "fiscalIdentifier")
    const registration = form.elements.namedItem("vatRegistered")
    const registered = registration instanceof HTMLInputElement && registration.checked
    const vat = resolveVatValues(registered, { code: formField(form, "vatRateCode"), rate: formField(form, "vatRate") })
    const existingConfigurations = issuer?.vatConfigurations ?? []
    const vatConfigurations = updateVatTimeline(existingConfigurations, nearestConfiguredVat(existingConfigurations, today()), vat, formField(form, "taxEffectiveFrom"))
    const mismatch = vatTimelineMismatch(countryCode, fiscalIdentifier, vatConfigurations)
    const taxIdentifierInput = form.elements.namedItem("fiscalIdentifier")
    if (taxIdentifierInput instanceof HTMLInputElement) taxIdentifierInput.setCustomValidity(mismatch ?? "")
    if (mismatch !== undefined) {
      const warning = form.querySelector<HTMLElement>("#vat-mismatch")
      if (warning !== null) { warning.hidden = false; warning.textContent = mismatch }
      if (taxIdentifierInput instanceof HTMLInputElement) taxIdentifierInput.reportValidity()
      return
    }
    let brandText: string | null
    try { brandText = normalizeBrandText(branding.text) } catch (cause) {
      setBrandingError(cause instanceof Error ? cause : new Error("Textul de brand este invalid."))
      return
    }
    const image = branding.image
    setBrandingError(null)
    saveIssuer.mutate({
      revision: editGuard.current.current(),
      input: {
        name: formField(form, "name"), fiscalIdentifier,
        address: { countryCode, city: formField(form, "city"), street: formField(form, "street"), ...(county === "" ? {} : { county }), ...(postalCode === "" ? {} : { postalCode }) },
        defaultCurrency: "RON", defaultPaymentTermDays: Number(formField(form, "defaultPaymentTermDays")), vatConfigurations,
        branding: brandText === null && image === null ? null : { text: brandText, image: image === null ? null : { dataBase64: image.dataBase64 } },
      },
    })
  }

  const tax = nearestConfiguredVat(issuer?.vatConfigurations ?? [], today())
  const countryCode = "RO"
  const fiscalIdentifier = issuer?.fiscalIdentifier ?? ""
  const configuredVat: VatValues = { code: tax?.code ?? "RO_STANDARD", rate: tax?.rate ?? "21.00" }
  const inferredVat = inferRomanianVatDefaults(countryCode, fiscalIdentifier)
  const vatRegistered = issuer === undefined ? (inferredVat?.registered ?? true) : !isNonVat(configuredVat)
  const vatMismatchMessage = issuer === undefined
    ? vatRegistrationMismatch(countryCode, fiscalIdentifier, vatRegistered)
    : vatTimelineMismatch(countryCode, fiscalIdentifier, issuer.vatConfigurations)

  return {
    issuerQuery, issuer, formKey: `${issuer?.organizationId ?? "new"}-${String(formVersion)}`,
    tax, fiscalIdentifier, configuredVat, vatRegistered, vatMismatchMessage,
    submit,
    save: { pending: saveIssuer.isPending, error: saveIssuer.error },
    branding: { ...branding, error: brandingError, pending: imagePending, changeText: changeBrandText, selectImage: selectBrandImage, removeImage: removeBrandImage, removeAll: removeBranding },
    normalizeFiscalIdentifier: (input: HTMLInputElement) => { input.setCustomValidity(""); input.value = normalizeRomanianCui(input.value) },
    inferVat: (input: HTMLInputElement) => {
      const form = input.form
      const registration = form?.elements.namedItem("vatRegistered")
      if (form === null || !(registration instanceof HTMLInputElement)) return
      const inferred = inferRomanianVatDefaults(formField(form, "countryCode"), formField(form, "fiscalIdentifier"))
      if (registration.dataset.manual === "true") { updateVatMismatch(form, registration.checked); return }
      if (inferred === undefined) return
      registration.checked = inferred.registered
      updateVatFields(form, inferred.registered, inferred.registered ? "Prefix RO detectat: firma este propusă ca plătitoare de TVA." : "CUI fără prefix RO: firma este propusă ca neplătitoare de TVA, cu cotă 0%.")
    },
    changeVatRegistration: (registration: HTMLInputElement) => {
      const form = registration.form
      if (form === null) return
      registration.dataset.manual = "true"
      const effectiveFrom = form.elements.namedItem("taxEffectiveFrom")
      if (effectiveFrom instanceof HTMLInputElement) effectiveFrom.value = today()
      updateVatFields(form, registration.checked, registration.checked ? "Firma a fost marcată explicit ca plătitoare de TVA." : "Firma a fost marcată explicit ca neplătitoare de TVA, cu cotă 0%.")
    },
    markVatEffectiveToday: (input: HTMLInputElement) => {
      const effectiveFrom = input.form?.elements.namedItem("taxEffectiveFrom")
      if (effectiveFrom instanceof HTMLInputElement) effectiveFrom.value = today()
    },
  }
}
