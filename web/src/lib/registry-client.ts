import { apiRequest } from "./api-transport.ts"
import { encoded, paged } from "./client-paths.ts"
import {
  decodeCustomer, decodeCustomerPage, decodeDeleted, decodeProductPreset,
  decodeProductPresetPage, decodeUnitOfMeasures, type PageRequest,
} from "./models.ts"
import type { CustomerInput, ProductPresetInput } from "./invoicing-client-types.ts"

export const registryClient = {
  listCustomers: (page?: PageRequest) => apiRequest(paged("/api/customers", page), decodeCustomerPage),
  createCustomer: (body: CustomerInput) =>
    apiRequest("/api/customers", decodeCustomer, { method: "POST", body }),
  updateCustomer: (id: string, body: CustomerInput) =>
    apiRequest(`/api/customers/${encoded(id)}`, decodeCustomer, { method: "PUT", body }),
  deleteCustomer: (id: string) =>
    apiRequest(`/api/customers/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
  listProductPresets: (page?: PageRequest) => apiRequest(paged("/api/product-presets", page), decodeProductPresetPage),
  listUnitOfMeasures: () => apiRequest("/api/unit-of-measures", decodeUnitOfMeasures),
  createProductPreset: (body: ProductPresetInput) =>
    apiRequest("/api/product-presets", decodeProductPreset, { method: "POST", body }),
  updateProductPreset: (id: string, body: ProductPresetInput) =>
    apiRequest(`/api/product-presets/${encoded(id)}`, decodeProductPreset, { method: "PUT", body }),
  deleteProductPreset: (id: string) =>
    apiRequest(`/api/product-presets/${encoded(id)}`, decodeDeleted, { method: "DELETE" }),
} as const
