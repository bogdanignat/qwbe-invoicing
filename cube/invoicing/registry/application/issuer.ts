import { Effect } from "effect"

import { checked, copyParty, missing, recordAuditEvent, type Authorize, type OperationDependencies } from "../../application/support.ts"
import { ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSeries, IssuerProfile } from "../../domain/invoice.ts"
import type { ConfigureDocumentSeriesInput, ConfigureIssuerInput } from "../../domain/inputs.ts"
import { validateDate, validateDocumentSeries } from "../../domain/validation.ts"
import { normalizeBrandingText, validateIssuer, validateIssuerProfile } from "../domain/validation.ts"
import { normalizeIssuerDetails } from "../domain/issuer-details.ts"
import { decodeStrictBase64, validateCanonicalImage } from "../domain/branding.ts"
import { inferVatRegistration, romanianVatRates, scheduleVatRegistration } from "../domain/vat-regime.ts"
import { issuerDate, issuerView, type IssuerView, type VatCatalogue, type VatInference } from "./issuer-view.ts"
export type { IssuerView, VatCatalogue, VatInference } from "./issuer-view.ts"

export interface IssuerOperations {
  readonly configureIssuer: (input: ConfigureIssuerInput) => Effect.Effect<IssuerView, InvoicingFailure>
  readonly getIssuer: () => Effect.Effect<IssuerView, InvoicingFailure>
  readonly getVatCatalogue: (inference?: VatInference) => Effect.Effect<VatCatalogue, InvoicingFailure>
  readonly addDocumentSeries: (input: ConfigureDocumentSeriesInput) => Effect.Effect<DocumentSeries, InvoicingFailure>
  readonly listDocumentSeries: () => Effect.Effect<ReadonlyArray<DocumentSeries>, InvoicingFailure>
}

export const createIssuerOperations = (
  dependencies: OperationDependencies,
  permissions: InvoicingPermissions,
  authorize: Authorize,
): IssuerOperations => {
  const configureIssuer = (input: ConfigureIssuerInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const now = yield* dependencies.clock.now
    const text = yield* checked(() => normalizeBrandingText(input.branding?.text ?? null))
    const rawImage = yield* checked(() => input.branding?.image === null || input.branding === null
      ? null
      : decodeStrictBase64(input.branding.image.dataBase64))
    yield* checked(() => { validateDate(input.vatChange.effectiveFrom, "vatChange.effectiveFrom") })
    const details = yield* checked(() => normalizeIssuerDetails(input))
    const profile = { ...copyParty(input), ...details, organizationId: context.organization.id,
      defaultCurrency: input.defaultCurrency, defaultPaymentTermDays: input.defaultPaymentTermDays, branding: null }
    yield* checked(() => { validateIssuerProfile(profile) })
    if (input.branding !== null && text === null && rawImage === null) {
      return yield* Effect.fail(new ValidationFailure({ issues: ["branding must contain text, image, or both"] }))
    }
    const image = rawImage === null ? null : yield* dependencies.branding.normalize(rawImage)
    if (image !== null) yield* checked(() => { validateCanonicalImage(image) })
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const existing = yield* transaction.findIssuer(context.organization.id)
      const vatConfigurations = yield* checked(() => scheduleVatRegistration(existing?.vatConfigurations ?? [], input.vatChange))
      const configured: IssuerProfile = {
        ...profile, vatConfigurations, branding: input.branding === null ? null : { text, image },
      }
      yield* checked(() => { validateIssuer(configured, issuerDate(now)) })
      yield* transaction.saveIssuer(configured)
      yield* recordAuditEvent(transaction, context, dependencies.ids, now, {
        action: "issuer.configured", targetKind: "issuer", targetId: context.organization.id,
      })
      return issuerView(configured, now)
    }))
  })
  const getIssuer = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const now = yield* dependencies.clock.now
    const issuer = yield* dependencies.store.transaction((transaction) => transaction.findIssuer(context.organization.id))
    return issuer === undefined ? yield* Effect.fail(missing("issuer", context.organization.id)) : issuerView(issuer, now)
  })
  const getVatCatalogue = (inference?: VatInference) => Effect.gen(function*() {
    yield* authorize(permissions.read)
    const inferred = inference === undefined ? undefined : inferVatRegistration(inference.countryCode, inference.fiscalIdentifier)
    return { rates: romanianVatRates.map((rate) => ({ ...rate })), inferredRegistration: inferred ?? null }
  })
  const addDocumentSeries = (input: ConfigureDocumentSeriesInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const now = yield* dependencies.clock.now
    const series: DocumentSeries = { organizationId: context.organization.id, ...input }
    yield* checked(() => { validateDocumentSeries(series) })
    yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      yield* transaction.addDocumentSeries(series)
      yield* recordAuditEvent(transaction, context, dependencies.ids, now, {
        action: "series.added", targetKind: "document_series", targetId: `${series.documentType}:${series.series}`,
      })
    }))
    return structuredClone(series)
  })
  const listDocumentSeries = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listDocumentSeries(context.organization.id)))
  })
  return { configureIssuer, getIssuer, getVatCatalogue, addDocumentSeries, listDocumentSeries }
}
