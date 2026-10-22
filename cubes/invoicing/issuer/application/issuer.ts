import { Effect } from "effect"

import { checked, copyParty, missing, type Authorize } from "../../application/support.ts"
import { ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { VatRegistryUnavailable } from "../contracts/fiscal-guard.ts"
import type { ConfigureIssuerInput } from "../domain/issuer.ts"
import type { BrandingNormalizer } from "./ports.ts"
import { validateDate } from "../../domain/validation.ts"
import { normalizeBrandingText, validateIssuerProfile } from "../domain/validation.ts"
import { normalizeIssuerDetails } from "../domain/issuer-details.ts"
import { decodeStrictBase64, validateCanonicalImage } from "../domain/branding.ts"
import { romanianVatRates } from "../domain/vat-catalogue.ts"
import { saveIssuerProfile, type IssuerSaveDependencies } from "./issuer-save.ts"
import { issuerView, type ConfiguredIssuer, type IssuerView, type VatCatalogue } from "./issuer-view.ts"
export type { ConfiguredIssuer, IssuerView, IssuerWarning, VatCatalogue } from "./issuer-view.ts"

export interface IssuerOperations {
  readonly configureIssuer: (input: ConfigureIssuerInput) => Effect.Effect<ConfiguredIssuer, InvoicingFailure | VatRegistryUnavailable>
  readonly getIssuer: () => Effect.Effect<IssuerView, InvoicingFailure>
  readonly getVatCatalogue: () => Effect.Effect<VatCatalogue, InvoicingFailure>
}

interface IssuerDependencies extends IssuerSaveDependencies {
  readonly branding: BrandingNormalizer
}

export const createIssuerOperations = (
  dependencies: IssuerDependencies,
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
    const branding = input.branding === null ? null : { text, image }
    return yield* saveIssuerProfile(dependencies, context, now, { ...profile, branding }, input.vatChange)
  })
  const getIssuer = () => Effect.gen(function*() {
    const context = yield* authorize(permissions.read)
    const now = yield* dependencies.clock.now
    const issuer = yield* dependencies.store.transaction((transaction) => transaction.findIssuer(context.organization.id))
    return issuer === undefined ? yield* Effect.fail(missing("issuer", context.organization.id)) : issuerView(issuer, now)
  })
  const getVatCatalogue = () => Effect.gen(function*() {
    yield* authorize(permissions.read)
    return { rates: romanianVatRates.map((rate) => ({ ...rate })) }
  })
  return { configureIssuer, getIssuer, getVatCatalogue }
}
