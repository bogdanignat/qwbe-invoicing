import { useQuery } from "@tanstack/react-query"
import { runUiEffect } from "../lib/api.ts"
import { invoicingClient } from "../lib/invoicing-client.ts"
import { authoringSeriesOptions } from "../lib/invoice-authoring-state.ts"
import type { Customer, Issuer, UnitOfMeasure, VatCatalogue } from "../lib/models.ts"
import { useVatCatalogue } from "./vat-hooks.ts"

export type ProformaAuthoringPageState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: Error }
  | { readonly kind: "issuer-required" }
  | { readonly kind: "vat-catalogue-empty" }
  | { readonly kind: "unit-catalogue-empty" }
  | {
      readonly kind: "ready"
      readonly issuer: Issuer
      readonly vatCatalogue: VatCatalogue
      readonly customers: ReadonlyArray<Customer>
      readonly proformaSeries: ReadonlyArray<string>
      readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
      readonly backgroundErrors: ReadonlyArray<Error>
    }

export const useProformaAuthoringPage = (): ProformaAuthoringPageState => {
  const vatCatalogue = useVatCatalogue()
  const customers = useQuery({
    queryKey: ["customers", "proforma-authoring"],
    queryFn: ({ signal }) => runUiEffect(invoicingClient.listCustomers({ limit: 200 }), signal),
  })
  const issuer = useQuery({
    queryKey: ["issuer"],
    queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal),
  })
  const series = useQuery({
    queryKey: ["document-series"],
    queryFn: ({ signal }) => runUiEffect(invoicingClient.listDocumentSeries(), signal),
  })
  const units = useQuery({
    queryKey: ["unit-of-measures"],
    queryFn: ({ signal }) => runUiEffect(invoicingClient.listUnitOfMeasures(), signal),
  })
  const requiredPending = (issuer.data === undefined && issuer.isPending)
    || (vatCatalogue.data === undefined && vatCatalogue.isPending)
    || (series.data === undefined && series.isPending)
    || (units.data === undefined && units.isPending)
    || (customers.data === undefined && customers.isPending)
  if (requiredPending) return { kind: "loading" }
  const blockingError = issuer.data === undefined
    ? issuer.error
    : vatCatalogue.data === undefined
      ? vatCatalogue.error
      : series.data === undefined
        ? series.error
        : units.data === undefined ? units.error : null
  if (blockingError !== null) return { kind: "error", error: blockingError }
  if (issuer.data === null || issuer.data === undefined) return { kind: "issuer-required" }
  if (vatCatalogue.data === undefined) return { kind: "vat-catalogue-empty" }
  if ((units.data ?? []).length === 0) return { kind: "unit-catalogue-empty" }
  return {
    kind: "ready",
    issuer: issuer.data,
    vatCatalogue: vatCatalogue.data,
    customers: customers.data?.items ?? [],
    proformaSeries: authoringSeriesOptions(series.data ?? []).proforma,
    unitOfMeasures: units.data ?? [],
    backgroundErrors: [customers.error, issuer.error, vatCatalogue.error, series.error, units.error]
      .filter((error): error is Error => error !== null),
  }
}
