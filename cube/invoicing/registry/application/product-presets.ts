import { Effect } from "effect"

import { checked, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { ProductPreset, ProductPresetInput, UpdateProductPresetInput } from "../../domain/invoice.ts"
import { normalizeProductPreset } from "../domain/validation.ts"

export interface ProductPresetOperations {
  readonly createProductPreset: (input: ProductPresetInput) => Effect.Effect<ProductPreset, InvoicingFailure>
  readonly listProductPresets: () => Effect.Effect<ReadonlyArray<ProductPreset>, InvoicingFailure>
  readonly updateProductPreset: (input: UpdateProductPresetInput) => Effect.Effect<ProductPreset, InvoicingFailure>
  readonly deleteProductPreset: (id: string) => Effect.Effect<void, InvoicingFailure>
}

export const createProductPresetOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): ProductPresetOperations => {
  const createProductPreset = (input: ProductPresetInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const normalized = yield* checked(() => normalizeProductPreset(input))
    const preset: ProductPreset = { id: yield* dependencies.ids.next, organizationId: context.organization.id, ...normalized }
    yield* dependencies.store.transaction((transaction) => transaction.saveProductPreset(preset))
    return structuredClone(preset)
  })
  const listProductPresets = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listProductPresets(context.organization.id)))
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
  return { createProductPreset, listProductPresets, updateProductPreset, deleteProductPreset }
}
