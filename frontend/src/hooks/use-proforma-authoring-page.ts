"use client"

import { useQuery } from "@tanstack/react-query"

import { useAuth } from "./auth-context.ts"
import { useAuthoringPagedList } from "./use-authoring-paged-list.ts"
import { useInvoicingClients } from "./use-invoicing-clients.ts"
import type { BackgroundError } from "./invoice-authoring-session-types.ts"
import type { ProformaAuthoringSessionInput } from "./proforma-authoring-session-types.ts"
import type { Customer, ProductPreset } from "../lib/draft-models.ts"
import { proformaAuthoringPageState, type ProformaAuthoringResource } from "../lib/proforma-authoring-page.ts"
import { resourceFailure } from "../lib/async-resource.ts"

/**
 * What the proforma authoring screen shows: the four blocking reads, the two
 * paged catalogues that are only background, and the decision between them
 * taken by the pure derivation in `proforma-authoring-page.ts`.
 *
 * The state union carries the session input directly, so the screen hands the
 * form everything it needs without unpacking the ready branch field by field.
 */
export type ProformaAuthoringPageState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: Error; readonly retry: () => void }
  | { readonly kind: "issuer-required" }
  | { readonly kind: "vat-catalogue-empty" }
  | { readonly kind: "unit-catalogue-empty" }
  | { readonly kind: "ready"; readonly session: ProformaAuthoringSessionInput }

export const useProformaAuthoringPage = (): ProformaAuthoringPageState => {
  const { status } = useAuth()
  const clients = useInvoicingClients()
  const enabled = status === "authenticated"
  const issuer = useQuery({
    queryKey: ["issuer"], enabled, queryFn: ({ signal }) => clients.reference.getIssuer(signal),
  })
  const vatCatalogue = useQuery({
    queryKey: ["vat-regimes"], enabled, queryFn: ({ signal }) => clients.reference.getVatCatalogue(signal),
  })
  const series = useQuery({
    queryKey: ["document-series"], enabled, queryFn: ({ signal }) => clients.reference.listDocumentSeries(signal),
  })
  const units = useQuery({
    queryKey: ["unit-of-measures"], enabled, queryFn: ({ signal }) => clients.reference.listUnitOfMeasures(signal),
  })
  const customers = useAuthoringPagedList<Customer>(["customers"], (page, signal) => clients.reference.listCustomers(page, signal))
  const presets = useAuthoringPagedList<ProductPreset>(["product-presets"], (page, signal) => clients.reference.listProductPresets(page, signal))
  // A reference list that fails is background, not blocking: the form stays
  // usable and each failure carries its own scoped retry.
  const backgroundIssue = (error: unknown, retry: (() => void) | undefined): BackgroundError | undefined =>
    error === null || error === undefined ? undefined : { error: resourceFailure(error), retry }
  const backgroundErrors = [
    backgroundIssue(customers.error, customers.retry),
    backgroundIssue(presets.error, presets.retry),
  ].filter((issue): issue is BackgroundError => issue !== undefined)
  const state = proformaAuthoringPageState({
    issuer: { data: issuer.data, isPending: issuer.isPending, error: issuer.error },
    vatCatalogue: { data: vatCatalogue.data, isPending: vatCatalogue.isPending, error: vatCatalogue.error },
    series: { data: series.data, isPending: series.isPending, error: series.error },
    units: { data: units.data, isPending: units.isPending, error: units.error },
  })
  // The buyer list is blocking on this screen only in the sense that the initial
  // buyer mode depends on whether saved customers exist; an empty first page is
  // a valid answer, a pending one is not.
  if (state.kind === "loading" || (customers.items === undefined && customers.isPending)) return { kind: "loading" }
  if (state.kind === "error") {
    const refetch: Readonly<Record<ProformaAuthoringResource, () => void>> = {
      issuer: () => { void issuer.refetch() },
      "vat-catalogue": () => { void vatCatalogue.refetch() },
      series: () => { void series.refetch() },
      units: () => { void units.refetch() },
    }
    return {
      kind: "error",
      error: state.error,
      retry: () => { for (const resource of state.reload) refetch[resource]() },
    }
  }
  if (state.kind !== "ready") return state
  return {
    kind: "ready",
    session: {
      issuer: state.issuer,
      vatCatalogue: state.vatCatalogue,
      proformaSeries: state.proformaSeries,
      unitOfMeasures: state.unitOfMeasures,
      customers: customers.items ?? [],
      customersHasMore: customers.hasMore,
      customersLoadingMore: customers.loadingMore,
      customersLoadMore: customers.loadMore,
      productPresets: presets.items ?? [],
      presetsHasMore: presets.hasMore,
      presetsLoadingMore: presets.loadingMore,
      presetsLoadMore: presets.loadMore,
      backgroundErrors,
    },
  }
}
