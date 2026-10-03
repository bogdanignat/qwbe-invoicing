"use client"

import { useQuery } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { useAuthoringPagedList } from "./use-authoring-paged-list.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import { useRegistryEditor, type RegistryEditorIssue } from "./use-registry-editor.ts"
import { useRegistryWrites } from "./use-registry-writes.ts"
import { ORGANIZATION_TIME_ZONE, todayIn } from "../lib/format.ts"
import { productPresetDeleteConfirm, productPresetNotice } from "../lib/registry-feedback.ts"
import { registryLoad, registryReload, type RegistryLoad } from "../lib/registry-load.ts"
import {
  newProductPresetForm, productPresetFormOf, productPresetPayload,
  type ProductPresetField, type ProductPresetForm,
} from "../lib/product-preset-form.ts"
import {
  preferableVatRates, presetVatLabel, presetVatOptions, type PresetVatOption,
} from "../lib/product-preset-vat.ts"
import type { ProductPreset, UnitOfMeasure } from "../lib/draft-models.ts"

/**
 * The product catalogue screen: the registry rows, the editor, and the three
 * writes between them.
 *
 * Every decision that is not a request lives in `lib` — which rates may be
 * preferred, what a filled form becomes, which field refuses it, whether the
 * screen may open at all — so this hook is wiring: queries in, one model out,
 * and a component with nothing to decide.
 */
export interface ProductPresetRow {
  readonly preset: ProductPreset
  readonly vatLabel: string
}

export interface ProductCatalogueModel {
  readonly load: RegistryLoad
  /** Absent when the failure is settled: a `403` or a `404` is not repeated on request. */
  readonly retry: (() => void) | undefined
  readonly rows: ReadonlyArray<ProductPresetRow>
  readonly hasMore: boolean
  readonly loadingMore: boolean
  readonly loadMore: () => void
  readonly units: ReadonlyArray<UnitOfMeasure>
  readonly vatOptions: ReadonlyArray<PresetVatOption>
  /** The record open in the editor; `id` absent means a product being created. */
  readonly editing: { readonly id: string | undefined } | undefined
  readonly form: ProductPresetForm | undefined
  readonly issue: RegistryEditorIssue<ProductPresetField> | undefined
  readonly pending: boolean
  readonly error: unknown
  readonly notice: string | undefined
  readonly startCreate: () => void
  readonly startEdit: (preset: ProductPreset) => void
  readonly close: () => void
  readonly change: (patch: Partial<ProductPresetForm>) => void
  readonly submit: () => void
  readonly remove: (preset: ProductPreset) => void
}

export const useProductPresets = (): ProductCatalogueModel => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const enabled = status === "authenticated"
  const list = useAuthoringPagedList<ProductPreset>(
    ["product-presets"], (page, signal) => clients.reference.listProductPresets(page, signal),
  )
  const units = useQuery({
    queryKey: ["unit-of-measures"], enabled, queryFn: ({ signal }) => clients.reference.listUnitOfMeasures(signal),
  })
  const vat = useQuery({
    queryKey: ["vat-regimes"], enabled, queryFn: ({ signal }) => clients.reference.getVatCatalogue(signal),
  })
  const writes = useRegistryWrites(["product-presets"], productPresetNotice)
  const editor = useRegistryEditor<ProductPresetForm, ProductPresetField>()

  const unitList = units.data ?? []
  // The server checks a rate against the date in Bucharest; so does this, or a
  // browser in another zone would be offered a set the server then refuses.
  const rates = vat.data === undefined ? [] : preferableVatRates(vat.data, todayIn(ORGANIZATION_TIME_ZONE))
  const load = registryLoad([
    ["presets", { data: list.items, isPending: list.isPending, error: list.error }],
    ["units", { data: units.data, isPending: units.isPending, error: units.error }],
    ["vat", { data: vat.data, isPending: vat.isPending, error: vat.error }],
  ])
  const refetch: Readonly<Record<string, () => void>> = {
    presets: () => { list.refetch() },
    units: () => { void units.refetch() },
    vat: () => { void vat.refetch() },
  }
  const editing = editor.editing
  const submit = (): void => {
    if (editing === undefined) return
    const validation = productPresetPayload(editing.form, unitList, rates)
    if (validation.kind === "issue") {
      editor.refuse({ field: validation.field, message: validation.message })
      return
    }
    const { id } = editing
    const { payload } = validation
    writes.submit({
      write: id === undefined ? "created" : "updated",
      run: (csrfToken) => id === undefined
        ? clients.registry.createProductPreset(csrfToken, payload)
        : clients.registry.updateProductPreset(csrfToken, id, payload),
      onDone: editor.close,
    })
  }
  return {
    load,
    retry: registryReload(load, refetch),
    rows: (list.items ?? []).map((preset) => ({
      preset, vatLabel: presetVatLabel(preset.preferredVatRateCode, rates),
    })),
    hasMore: list.hasMore,
    loadingMore: list.loadingMore,
    loadMore: list.loadMore,
    units: unitList,
    // The code being edited is retained, so a preference that expired keeps an
    // option of its own instead of silently reading as the issuer's default.
    vatOptions: presetVatOptions(rates, [editing?.form.preferredVatRateCode]),
    editing: editing === undefined ? undefined : { id: editing.id },
    form: editing?.form,
    issue: editor.issue,
    pending: writes.pending,
    error: writes.error,
    notice: writes.notice,
    startCreate: () => { writes.dismissNotice(); editor.open(undefined, newProductPresetForm(unitList)) },
    startEdit: (preset) => { writes.dismissNotice(); editor.open(preset.id, productPresetFormOf(preset)) },
    close: editor.close,
    change: editor.change,
    submit,
    remove: (preset) => {
      if (!window.confirm(productPresetDeleteConfirm(preset.description))) return
      writes.submit({
        write: "deleted",
        run: (csrfToken) => clients.registry.deleteProductPreset(csrfToken, preset.id),
        onDone: () => { editor.closeRecord(preset.id) },
      })
    },
  }
}
