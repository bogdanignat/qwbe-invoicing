import type { IssuerProfile } from "../../domain/invoice.ts"
import { currentVatRegistration, type VatRate, type VatRegistration } from "../domain/vat-regime.ts"

export type IssuerView = IssuerProfile & { readonly currentVat: VatRegistration | null }
export interface VatCatalogue {
  readonly rates: ReadonlyArray<VatRate>
  readonly inferredRegistration: boolean | null
}
export interface VatInference { readonly countryCode: string; readonly fiscalIdentifier: string }

const calendar = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" })
export const issuerDate = (now: Date): string => calendar.format(now)

export const issuerView = (issuer: IssuerProfile, now: Date): IssuerView => ({
  ...structuredClone(issuer), currentVat: currentVatRegistration(issuer.vatConfigurations, issuerDate(now)) ?? null,
})
