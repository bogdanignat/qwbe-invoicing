import { Effect } from "effect"

import { checked, missing, namePageQuery, pageOf, type Authorize, type OperationDependencies, type Page, type PageRequest } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import { unitOfMeasures, type UnitOfMeasure } from "../../domain/unit-of-measures.ts"
import { normalizeProductPreset, type ProductPreset, type ProductPresetInput, type UpdateProductPresetInput } from "../domain/product-preset.ts"
import type { CatalogTransaction } from "./ports.ts"

export interface CatalogOperations {
  readonly createProductPreset: (input: ProductPresetInput) => Effect.Effect<ProductPreset, InvoicingFailure>
  readonly listProductPresets: (page?: PageRequest) => Effect.Effect<Page<ProductPreset>, InvoicingFailure>
  readonly updateProductPreset: (input: UpdateProductPresetInput) => Effect.Effect<ProductPreset, InvoicingFailure>
  readonly deleteProductPreset: (id: string) => Effect.Effect<void, InvoicingFailure>
  // The list is the kernel's, because every document line is checked against it; the
  // catalog is where it is offered to choose from.
  readonly listUnitOfMeasures: () => Effect.Effect<ReadonlyArray<UnitOfMeasure>, InvoicingFailure>
}

export const createCatalogOperations = (
  dependencies: OperationDependencies<CatalogTransaction>,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): CatalogOperations => {
  const createProductPreset = (input: ProductPresetInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const normalized = yield* checked(() => normalizeProductPreset(input))
    const preset: ProductPreset = { id: yield* dependencies.ids.next, organizationId: context.organization.id, ...normalized }
    yield* dependencies.store.transaction((transaction) => transaction.saveProductPreset(preset))
    return structuredClone(preset)
  })
  const listProductPresets = (page?: PageRequest) => Effect.gen(function*() {
    const query = yield* checked(() => namePageQuery(page))
    const context = yield* authorize(permissions.read)
    const rows = yield* dependencies.store.transaction((transaction) => transaction.listProductPresets(context.organization.id, query))
    return pageOf(rows, query, (preset) => ({ name: preset.description, id: preset.id }))
  })
  const updateProductPreset = (input: UpdateProductPresetInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      if ((yield* transaction.findProductPreset(context.organization.id, input.id)) === undefined) {
        return yield* Effect.fail(missing("product_preset", input.id))
      }
      const normalized = yield* checked(() => normalizeProductPreset(input))
      const preset: ProductPreset = { id: input.id, organizationId: context.organization.id, ...normalized }
      yield* transaction.saveProductPreset(preset)
      return structuredClone(preset)
    }))
  })
  const deleteProductPreset = (id: string) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      if ((yield* transaction.findProductPreset(context.organization.id, id)) === undefined) {
        return yield* Effect.fail(missing("product_preset", id))
      }
      yield* transaction.deleteProductPreset(context.organization.id, id)
    }))
  })
  const listUnitOfMeasures = () => Effect.gen(function*() {
    yield* authorize(permissions.read)
    return unitOfMeasures.map((unit) => ({ ...unit }))
  })
  return { createProductPreset, listProductPresets, updateProductPreset, deleteProductPreset, listUnitOfMeasures }
}
