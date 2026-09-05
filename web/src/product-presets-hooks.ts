import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { runUiEffect } from "./api.ts"
import { formField, type FormSubmitEvent } from "./form.ts"
import { invoicingClient, type ProductPresetInput } from "./invoicing-client.ts"
import type { ProductPreset } from "./models.ts"
import { usePagedList } from "./paged-query.ts"

interface ProductPresetSaveRequest {
  readonly id?: string
  readonly body: ProductPresetInput
  readonly form: HTMLFormElement
}

export const useProductPresetsRegistry = (notify: (message: string) => void) => {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState<ProductPreset | undefined>(undefined)
  const presets = usePagedList(["product-presets"], (page) => invoicingClient.listProductPresets(page))
  const unitOfMeasures = useQuery({ queryKey: ["unit-of-measures"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listUnitOfMeasures(), signal) })
  const save = useMutation({
    mutationFn: (request: ProductPresetSaveRequest) => request.id === undefined
      ? runUiEffect(invoicingClient.createProductPreset(request.body))
      : runUiEffect(invoicingClient.updateProductPreset(request.id, request.body)),
    onSuccess: async (_preset, request) => {
      request.form.reset()
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
    if (unitOfMeasure === undefined) return
    const body: ProductPresetInput = { description: formField(form, "description"),
      unitPrice: formField(form, "unitPrice").replace(",", "."), unitOfMeasure }
    save.mutate({ ...(editing === undefined ? {} : { id: editing.id }), body, form })
  }
  const remove = (preset: ProductPreset): void => {
    if (window.confirm(`Ștergi produsul „${preset.description}”? Liniile deja completate rămân neschimbate.`)) removal.mutate(preset.id)
  }
  return { presets, unitOfMeasures, editing, edit: setEditing, cancelEdit: () => { setEditing(undefined) }, submit, save, removal, remove }
}
