import { Effect } from "effect"

import { checked, copyParty, missing, recordAuditEvent, type Authorize, type OperationDependencies } from "../../application/support.ts"
import type { InvoicingTransaction } from "../../application/ports.ts"
import { ValidationFailure, type InvoicingFailure } from "../../contracts/failures.ts"
import type { InvoicingPermissions } from "../../contracts/permissions.ts"
import type { ConfigureIssuerInput, IssuerProfile } from "../domain/issuer.ts"
import type { BrandingNormalizer, IssuerTransaction } from "./ports.ts"
import { validateDate } from "../../domain/validation.ts"
import { normalizeBrandingText, validateIssuer, validateIssuerProfile } from "../domain/validation.ts"
import { normalizeIssuerDetails } from "../domain/issuer-details.ts"
import { decodeStrictBase64, validateCanonicalImage } from "../domain/branding.ts"
import { romanianVatRates } from "../domain/vat-catalogue.ts"
import { scheduleVatRegistration } from "../domain/vat-regime.ts"
import { issuerView, type IssuerView, type VatCatalogue } from "./issuer-view.ts"
export type { IssuerView, VatCatalogue } from "./issuer-view.ts"

export interface IssuerOperations {
  readonly configureIssuer: (input: ConfigureIssuerInput) => Effect.Effect<IssuerView, InvoicingFailure>
  readonly getIssuer: () => Effect.Effect<IssuerView, InvoicingFailure>
  readonly getVatCatalogue: () => Effect.Effect<VatCatalogue, InvoicingFailure>
}

interface IssuerDependencies extends OperationDependencies<InvoicingTransaction & IssuerTransaction> {
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
    return yield* dependencies.store.transaction((transaction) => Effect.gen(function*() {
      const existing = yield* transaction.findIssuer(context.organization.id)
      const vatConfigurations = yield* checked(() => scheduleVatRegistration(existing?.vatConfigurations ?? [], input.vatChange))
      const configured: IssuerProfile = {
        ...profile, vatConfigurations, branding: input.branding === null ? null : { text, image },
      }
      yield* checked(() => { validateIssuer(configured) })
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
  const getVatCatalogue = () => Effect.gen(function*() {
    yield* authorize(permissions.read)
    return { rates: romanianVatRates.map((rate) => ({ ...rate })) }
  })
  return { configureIssuer, getIssuer, getVatCatalogue }
}
