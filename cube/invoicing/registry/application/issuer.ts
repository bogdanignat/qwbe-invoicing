import { Effect } from "effect"

import { audit, checked, copyParty, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSeries, IssuerProfile, VatConfiguration } from "../../domain/invoice.ts"
import type { ConfigureDocumentSeriesInput, ConfigureIssuerInput } from "../../domain/inputs.ts"
import { calendarDate, validateDate, validateDocumentSeries } from "../../domain/validation.ts"
import { validateIssuer } from "../domain/validation.ts"
import { effectiveVatConfiguration, inferVatRegime, romanianVatRegimes, scheduleVatRegime, type VatRegime } from "../domain/vat-regime.ts"

// The stored profile plus the configuration in force today, so callers never resolve VAT periods themselves.
export type IssuerView = IssuerProfile & { readonly currentVat: VatConfiguration | null }
export interface VatRegimes {
  readonly regimes: ReadonlyArray<VatRegime>
  readonly inferred: VatRegime | null
}
export interface VatInference { readonly countryCode: string; readonly fiscalIdentifier: string }

export interface IssuerOperations {
  readonly configureIssuer: (input: ConfigureIssuerInput) => Effect.Effect<IssuerView, InvoicingFailure>
  readonly getIssuer: () => Effect.Effect<IssuerView, InvoicingFailure>
  readonly listVatRegimes: (inference?: VatInference) => Effect.Effect<VatRegimes, InvoicingFailure>
  readonly addDocumentSeries: (input: ConfigureDocumentSeriesInput) => Effect.Effect<DocumentSeries, InvoicingFailure>
  readonly listDocumentSeries: () => Effect.Effect<ReadonlyArray<DocumentSeries>, InvoicingFailure>
}

const view = (issuer: IssuerProfile, now: Date): IssuerView => ({
  ...structuredClone(issuer), currentVat: effectiveVatConfiguration(issuer.vatConfigurations, calendarDate(now)) ?? null,
})

export const createIssuerOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): IssuerOperations => {
  const configureIssuer = (input: ConfigureIssuerInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const now = yield* dependencies.clock.now
    const issuer = yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const existing = yield* transaction.findIssuer(context.organization.id)
      const vatConfigurations = yield* checked(() => {
        if (input.vatChange === undefined) return structuredClone(input.vatConfigurations)
        validateDate(input.vatChange.effectiveFrom, "vatChange.effectiveFrom")
        return scheduleVatRegime(existing?.vatConfigurations ?? [], input.vatChange)
      })
      const issuer: IssuerProfile = {
        ...copyParty(input), organizationId: context.organization.id,
        defaultCurrency: input.defaultCurrency, defaultPaymentTermDays: input.defaultPaymentTermDays, vatConfigurations,
      }
      yield* checked(() => { validateIssuer(issuer) })
      yield* transaction.saveIssuer(issuer)
      yield* audit(transaction, context, dependencies.ids, now, { action: "issuer.configured", targetKind: "issuer", targetId: issuer.organizationId })
      return issuer
    }))
    return view(issuer, now)
  })
  const getIssuer = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const now = yield* dependencies.clock.now
    const issuer = yield* dependencies.store.transaction((transaction) => transaction.findIssuer(context.organization.id))
    return issuer === undefined ? yield* Effect.fail(missing("issuer", context.organization.id)) : view(issuer, now)
  })
  const listVatRegimes = (inference?: VatInference) => Effect.gen(function*() {
    yield* authorize(permissions.read)
    const inferred = inference === undefined ? undefined : inferVatRegime(inference.countryCode, inference.fiscalIdentifier)
    return { regimes: romanianVatRegimes.map((regime) => ({ ...regime })), inferred: inferred === undefined ? null : { ...inferred } }
  })
  const addDocumentSeries = (input: ConfigureDocumentSeriesInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const series: DocumentSeries = { organizationId: context.organization.id, ...input }
    yield* checked(() => { validateDocumentSeries(series) })
    const now = yield* dependencies.clock.now
    yield* dependencies.store.transaction((transaction) => Effect.andThen(transaction.addDocumentSeries(series),
      audit(transaction, context, dependencies.ids, now, { action: "series.added", targetKind: "document_series", targetId: `${series.documentType}:${series.series}` })))
    return structuredClone(series)
  })
  const listDocumentSeries = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listDocumentSeries(context.organization.id)))
  })
  return { configureIssuer, getIssuer, listVatRegimes, addDocumentSeries, listDocumentSeries }
}
