import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { runUiEffect } from "./api.ts"
import { formField, type FormSubmitEvent } from "./form.ts"
import { todayIn } from "./format.ts"
import { invoicingClient, type ProductPresetInput } from "./invoicing-client.ts"
import type { ProductPreset } from "./models.ts"
import { usePagedList } from "./paged-query.ts"
import { preferableVatRates, presetVatIssue } from "./product-preset-vat.ts"
import { useVatCatalogue } from "./vat-hooks.ts"

interface ProductPresetSaveRequest {
  readonly id?: string
  readonly body: ProductPresetInput
}

export const useProductPresetsRegistry = (notify: (message: string) => void) => {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ProductPreset | undefined>(undefined)
  // Bumped on every successful save: the form remounts, so its fields and the VAT choice start over.
  const [savedForms, setSavedForms] = useState(0)
  const presets = usePagedList(["product-presets"], (page) => invoicingClient.listProductPresets(page))
  const unitOfMeasures = useQuery({ queryKey: ["unit-of-measures"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listUnitOfMeasures(), signal) })
  const vatCatalogue = useVatCatalogue()
  // Europe/Bucharest, like the server's check, so the offered rates never depend on the browser's zone.
  const vatRates = vatCatalogue.data === undefined ? undefined : preferableVatRates(vatCatalogue.data, todayIn("Europe/Bucharest"))
  const save = useMutation({
    mutationFn: (request: ProductPresetSaveRequest) => request.id === undefined
      ? runUiEffect(invoicingClient.createProductPreset(request.body))
      : runUiEffect(invoicingClient.updateProductPreset(request.id, request.body)),
    onSuccess: async (_preset, request) => {
      setSavedForms((count) => count + 1)
      setEditing(undefined)
      await queryClient.invalidateQueries({ queryKey: ["product-presets"] })
      notify(request.id === undefined ? "Produsul a fost adăugat." : "Produsul a fost actualizat.")
    },
  })
  const removal = useMutation({
    mutationFn: (id: string) => runUiEffect(invoicingClient.deleteProductPreset(id)),
    onSuccess: async (_result, id) => {
      if (editing?.id === id) setEditing(undefined)
      await queryClient.invalidateQueries({ queryKey: ["product-presets"] })
      notify("Produsul a fost șters.")
    },
  })
  const submit = (event: FormSubmitEvent): void => {
    event.preventDefault()
    const form = event.currentTarget
    const unitOfMeasure = unitOfMeasures.data?.find(({ code }) => code === formField(form, "unitOfMeasure"))
    if (unitOfMeasure === undefined || vatRates === undefined) return
    const preferredVatRateCode = formField(form, "preferredVatRateCode")
    if (presetVatIssue(preferredVatRateCode, vatRates) !== null) {
      const field = form.elements.namedItem("preferredVatRateCode")
      if (field instanceof HTMLSelectElement) field.focus()
      return
    }
    const body: ProductPresetInput = { description: formField(form, "description"),
      unitPrice: formField(form, "unitPrice").replace(",", "."), unitOfMeasure,
      ...(preferredVatRateCode === "" ? {} : { preferredVatRateCode }) }
    save.mutate({ ...(editing === undefined ? {} : { id: editing.id }), body })
  }
  const remove = (preset: ProductPreset): void => {
    if (window.confirm(`Ștergi produsul „${preset.description}”? Liniile deja completate rămân neschimbate.`)) removal.mutate(preset.id)
  }
  return { presets, unitOfMeasures, vatCatalogue, vatRates, editing, formKey: `${editing?.id ?? "new"}:${String(savedForms)}`, edit: setEditing, cancelEdit: () => { setEditing(undefined) }, submit, save, removal, remove }
}
