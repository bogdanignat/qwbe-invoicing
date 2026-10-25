const identity = "items"

export const cube = {
  manifest: {
    name: identity,
    parent: "invoicing",
    summary: "Article code and GTIN (EAN) rules shared by the product nomenclature and every document line",
    required: true,
    tables: [],
    requiresAuth: true,
    permissions: [],
  },
  create: () => ({ handlers: {} }),
}

export { itemIdentifiers, normalizeItemCode, validateBarcode } from "./domain/item-identifiers.ts"
