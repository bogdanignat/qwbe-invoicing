const identity = "catalog"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    summary: "Saved products and services of an organization and the unit-of-measure list they are chosen from",
    required: true,
    tables: ["product_presets"],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { createCatalogOperations } from "./application/catalog.ts"
export type { CatalogOperations } from "./application/catalog.ts"
export type { CatalogTransaction } from "./application/ports.ts"
export { normalizeProductPreset } from "./domain/product-preset.ts"
export type { ProductPreset, ProductPresetInput, UpdateProductPresetInput } from "./domain/product-preset.ts"
export { catalogMigrations } from "./contracts/migrations.ts"
export type { CatalogMigration } from "./contracts/migrations.ts"
