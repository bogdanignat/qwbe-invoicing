import type { IssuerProfile } from "../domain/issuer.ts"
import type { VatRate } from "../domain/vat-catalogue.ts"
import { currentVatRegistration, type VatRegistration } from "../domain/vat-regime.ts"

export type IssuerView = IssuerProfile & { readonly currentVat: VatRegistration | null }
/** `vat_registry_not_checked`: a fiscal change saved while the company-lookup plugin, and with it the registry, is off. */
export type IssuerWarning = "vat_registry_not_checked"
export type ConfiguredIssuer = IssuerView & { readonly warnings: ReadonlyArray<IssuerWarning> }
export interface VatCatalogue {
  readonly rates: ReadonlyArray<VatRate>
}

const calendar = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" })
export const issuerDate = (now: Date): string => calendar.format(now)

export const issuerView = (issuer: IssuerProfile, now: Date): IssuerView => ({
  ...structuredClone(issuer), currentVat: currentVatRegistration(issuer.vatConfigurations, issuerDate(now)) ?? null,
})
