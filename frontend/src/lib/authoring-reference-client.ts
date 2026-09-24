import {
  decodeCustomerPage, decodeDocumentSeriesList, decodeIssuer, decodeProductPresetPage,
  decodeUnitOfMeasures, decodeVatCatalogue,
} from "./authoring-reference-decoders.ts"
import { paged } from "./client-paths.ts"
import { ApiFailure } from "./api-errors.ts"
import type { BrowserTransport } from "./browser-transport.ts"
import type {
  Customer, DocumentSeries, Issuer, ProductPreset, UnitOfMeasure, VatCatalogue,
} from "./draft-models.ts"
import type { Page, PageRequest } from "./model-decoder.ts"

/**
 * The reference data an authoring session reads: issuer, series, units, VAT
 * catalogue, and the cursor-paged customer and product registries.
 *
 * The issuer answers `404` until it has been configured, and that is a state
 * ("configure the issuer first"), not a failure, so it is turned into `null`
 * here — the one place that knows the status code — instead of letting every
 * caller re-classify an error.
 */
export interface AuthoringReferenceClient {
  readonly getIssuer: (signal: AbortSignal) => Promise<Issuer | null>
  readonly listDocumentSeries: (signal: AbortSignal) => Promise<ReadonlyArray<DocumentSeries>>
  readonly listUnitOfMeasures: (signal: AbortSignal) => Promise<ReadonlyArray<UnitOfMeasure>>
  readonly getVatCatalogue: (signal: AbortSignal) => Promise<VatCatalogue>
  readonly listCustomers: (page: PageRequest | undefined, signal: AbortSignal) => Promise<Page<Customer>>
  readonly listProductPresets: (page: PageRequest | undefined, signal: AbortSignal) => Promise<Page<ProductPreset>>
}

export const createAuthoringReferenceClient = (transport: BrowserTransport): AuthoringReferenceClient => ({
  getIssuer: async (signal) => {
    try {
      return decodeIssuer(await transport.json("/api/issuer", { signal }))
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 404) return null
      throw error
    }
  },
  listDocumentSeries: async (signal) =>
    decodeDocumentSeriesList(await transport.json("/api/document-series", { signal })),
  listUnitOfMeasures: async (signal) =>
    decodeUnitOfMeasures(await transport.json("/api/unit-of-measures", { signal })),
  getVatCatalogue: async (signal) =>
    decodeVatCatalogue(await transport.json("/api/vat-regimes", { signal })),
  listCustomers: async (page, signal) =>
    decodeCustomerPage(await transport.json(paged("/api/customers", page), { signal })),
  listProductPresets: async (page, signal) =>
    decodeProductPresetPage(await transport.json(paged("/api/product-presets", page), { signal })),
})
