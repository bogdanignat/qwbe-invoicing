import { useQuery } from "@tanstack/react-query"

import { runUiEffect } from "./api.ts"
import { authoringAccess, authoringSeriesOptions } from "./invoice-authoring-state.ts"
import { invoicingClient } from "./invoicing-client.ts"
import type { Customer, DraftInvoice, Issuer, UnitOfMeasure, VatCatalogue } from "./models.ts"
import { useVatCatalogue } from "./vat-hooks.ts"

export type InvoiceAuthoringPageState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly error: Error }
  | { readonly kind: "issuer-required" }
  | { readonly kind: "vat-catalogue-empty" }
  | { readonly kind: "invoice-series-required" }
  | { readonly kind: "unit-catalogue-empty" }
  | { readonly kind: "draft-missing" }
  | { readonly kind: "locked"; readonly title: string; readonly notice: string; readonly registryHref: "/invoices" | "/proformas"; readonly registryLabel: string }
  | {
      readonly kind: "ready"
      readonly sessionKey: string
      readonly initialDraft?: DraftInvoice
      readonly issuer: Issuer
      readonly vatCatalogue: VatCatalogue
      readonly customers: ReadonlyArray<Customer>
      readonly invoiceSeries: ReadonlyArray<string>
      readonly proformaSeries: ReadonlyArray<string>
      readonly unitOfMeasures: ReadonlyArray<UnitOfMeasure>
      readonly backgroundErrors: ReadonlyArray<Error>
    }

export const useInvoiceAuthoringPage = (id: string | undefined): InvoiceAuthoringPageState => {
  const vatCatalogue = useVatCatalogue()
  const customers = useQuery({ queryKey: ["customers", "authoring"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listCustomers({ limit: 200 }), signal) })
  const issuer = useQuery({ queryKey: ["issuer"], queryFn: ({ signal }) => runUiEffect(invoicingClient.getIssuer(), signal) })
  const series = useQuery({ queryKey: ["document-series"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listDocumentSeries(), signal) })
  const unitOfMeasures = useQuery({ queryKey: ["unit-of-measures"], queryFn: ({ signal }) => runUiEffect(invoicingClient.listUnitOfMeasures(), signal) })
  const draft = useQuery({
    queryKey: ["draft", id], enabled: id !== undefined,
    queryFn: ({ signal }) => id === undefined ? Promise.reject(new Error("Lipsește identificatorul draftului.")) : runUiEffect(invoicingClient.getDraft(id), signal),
  })
  if (id !== undefined && draft.data === undefined && draft.isPending) return { kind: "loading" }
  const loadedDraft = draft.data
  const access = loadedDraft === undefined ? undefined : authoringAccess(loadedDraft.status)
  if (loadedDraft !== undefined && access !== undefined && !access.editable) return {
    kind: "locked", title: `Draft ${loadedDraft.series}`, notice: access.notice,
    registryHref: access.registryHref, registryLabel: access.registryLabel,
  }
  const requiredPending = (issuer.data === undefined && issuer.isPending)
    || (vatCatalogue.data === undefined && vatCatalogue.isPending)
    || (series.data === undefined && series.isPending)
    || (unitOfMeasures.data === undefined && unitOfMeasures.isPending)
    || (id === undefined && customers.data === undefined && customers.isPending)
  if (requiredPending) return { kind: "loading" }
  const blockingError = issuer.data === undefined
    ? issuer.error
    : vatCatalogue.data === undefined
      ? vatCatalogue.error
      : series.data === undefined
        ? series.error
        : unitOfMeasures.data === undefined
          ? unitOfMeasures.error
          : id !== undefined && draft.data === undefined
            ? draft.error
            : null
  if (blockingError !== null) return { kind: "error", error: blockingError }
  if (issuer.data === null || issuer.data === undefined) return { kind: "issuer-required" }
  if (vatCatalogue.data === undefined) return { kind: "vat-catalogue-empty" }
  const seriesOptions = authoringSeriesOptions(series.data ?? [])
  if (seriesOptions.invoice.length === 0) return { kind: "invoice-series-required" }
  if ((unitOfMeasures.data ?? []).length === 0) return { kind: "unit-catalogue-empty" }
  if (id !== undefined && draft.data === undefined) return { kind: "draft-missing" }
  return {
    kind: "ready", sessionKey: draft.data?.id ?? "new",
    ...(draft.data === undefined ? {} : { initialDraft: draft.data }),
    issuer: issuer.data, vatCatalogue: vatCatalogue.data, customers: customers.data?.items ?? [],
    invoiceSeries: seriesOptions.invoice, proformaSeries: seriesOptions.proforma,
    unitOfMeasures: unitOfMeasures.data ?? [],
    backgroundErrors: [customers.error, issuer.error, vatCatalogue.error, series.error, unitOfMeasures.error, draft.error]
      .filter((error): error is Error => error !== null),
  }
}
