import { useQuery } from "@tanstack/react-query"
import type { Dispatch, SetStateAction } from "react"

import { runUiEffect } from "./api.ts"
import { invoicingClient } from "./invoicing-client.ts"
import { choosePresetForLine, type EditableInvoiceLine } from "./invoice-authoring-state.ts"

interface AuthoringPresetInput {
  readonly setLines: Dispatch<SetStateAction<ReadonlyArray<EditableInvoiceLine>>>
  // Resolves a product's preferred VAT code on the form's current document date.
  readonly vatCodeFor: (preferred: string | undefined) => string
}

export const useInvoiceAuthoringPresets = (input: AuthoringPresetInput) => {
  const presets = useQuery({ queryKey: ["product-presets", "authoring"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listProductPresets({ limit: 200 }), signal) })
  const choosePreset = (lineKey: string, presetId: string): void => {
    const preset = presets.data?.items.find((item) => item.id === presetId)
    if (preset === undefined) return
    const vatRateCode = input.vatCodeFor(preset.preferredVatRateCode)
    input.setLines((lines) => choosePresetForLine(lines, lineKey, preset, vatRateCode))
  }
  return { presets: presets.data?.items ?? [], error: presets.error, choosePreset }
}
