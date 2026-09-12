import { Effect } from "effect"

import { checked, copyParty, missing, type Authorize, type OperationDependencies } from "../../application/support.ts"
import { ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { DocumentSeries, IssuerProfile } from "../../domain/invoice.ts"
import type { ConfigureDocumentSeriesInput, ConfigureIssuerInput } from "../../domain/inputs.ts"
import { validateDocumentSeries } from "../../domain/validation.ts"
import { normalizeBrandingText, validateIssuer } from "../domain/validation.ts"
import { normalizeIssuerDetails } from "../domain/issuer-details.ts"
import { decodeStrictBase64, validateCanonicalImage } from "../domain/branding.ts"

export interface IssuerOperations {
  readonly configureIssuer: (input: ConfigureIssuerInput) => Effect.Effect<IssuerProfile, InvoicingFailure>
  readonly getIssuer: () => Effect.Effect<IssuerProfile, InvoicingFailure>
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
    const text = yield* checked(() => normalizeBrandingText(input.branding?.text ?? null))
    const rawImage = yield* checked(() => input.branding?.image === null || input.branding === null
      ? null
      : decodeStrictBase64(input.branding.image.dataBase64))
    const issuer: IssuerProfile = {
      ...copyParty(input), organizationId: context.organization.id,
      ...yield* checked(() => normalizeIssuerDetails(input)),
      defaultCurrency: input.defaultCurrency, defaultPaymentTermDays: input.defaultPaymentTermDays,
      vatConfigurations: structuredClone(input.vatConfigurations),
      branding: null,
    }
    yield* checked(() => { validateIssuer(issuer) })
    if (input.branding !== null && text === null && rawImage === null) {
      return yield* Effect.fail(new ValidationFailure({ issues: ["branding must contain text, image, or both"] }))
    }
    const image = rawImage === null ? null : yield* dependencies.branding.normalize(rawImage)
    if (image !== null) yield* checked(() => { validateCanonicalImage(image) })
    const configured: IssuerProfile = {
      ...issuer,
      branding: input.branding === null ? null : { text, image },
    }
    yield* dependencies.store.transaction((transaction) => transaction.saveIssuer(configured))
    return structuredClone(configured)
  })
  const getIssuer = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const issuer = yield* dependencies.store.transaction((transaction) => transaction.findIssuer(context.organization.id))
    return issuer === undefined ? yield* Effect.fail(missing("issuer", context.organization.id)) : structuredClone(issuer)
  })
  const addDocumentSeries = (input: ConfigureDocumentSeriesInput) => Effect.gen(function*() {
    const context = yield* authorize(permissions.manageSettings)
    const series: DocumentSeries = { organizationId: context.organization.id, ...input }
    yield* checked(() => { validateDocumentSeries(series) })
    yield* dependencies.store.transaction((transaction) => transaction.addDocumentSeries(series))
    return structuredClone(series)
  })
  const listDocumentSeries = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    return structuredClone(yield* dependencies.store.transaction((transaction) => transaction.listDocumentSeries(context.organization.id)))
  })
  return { configureIssuer, getIssuer, addDocumentSeries, listDocumentSeries }
}
