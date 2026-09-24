import type { Customer, DraftInvoice, Issuer, ProductPreset, UnitOfMeasure, VatCatalogue } from "../lib/draft-models.ts"
import type { BackgroundError } from "./invoice-authoring-session-types.ts"

export type InvoiceAuthoringPageState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: Error; readonly retry: () => void }
  | { readonly kind: "issuer-required" }
  | { readonly kind: "vat-catalogue-empty" }
  | { readonly kind: "invoice-series-required" }
  | { readonly kind: "unit-catalogue-empty" }
  | {
    readonly kind: "locked"
    readonly title: string
    readonly notice: string
    readonly registryHref: "/invoices"
    readonly registryLabel: string
  }
  | { readonly kind: "draft-missing" }
  | {
    readonly kind: "ready"
    readonly sessionKey: string
    readonly initialDraft: DraftInvoice | undefined
    readonly issuer: Issuer
    readonly vatCatalogue: VatCatalogue
    readonly customers: ReadonlyArray<Customer>
    readonly customersHasMore: boolean
    readonly customersLoadingMore: boolean
    readonly customersLoadMore: () => void
    readonly invoiceSeries: ReadonlyArray<string>
    readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
    readonly productPresets: ReadonlyArray<ProductPreset>
    readonly presetsHasMore: boolean
    readonly presetsLoadingMore: boolean
    readonly presetsLoadMore: () => void
    readonly backgroundErrors: ReadonlyArray<BackgroundError>
  }
