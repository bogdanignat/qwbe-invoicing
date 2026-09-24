import type {
  Issuer, NonVatBasis, VatCatalogue, VatConfiguration, VatRate,
} from "./draft-models.ts"
import { isTaxableVatCode } from "./draft-decoders.ts"

export const romanianCuiPattern = "[1-9][0-9]{1,9}"
export const normalizeRomanianCui = (value: string): string =>
  value.trim().toUpperCase().replace(/^RO/, "")

export const activeOn = (
  value: { readonly effectiveFrom: string; readonly effectiveTo?: string },
  date: string,
): boolean => value.effectiveFrom <= date
  && (value.effectiveTo === undefined || date <= value.effectiveTo)

const scaledVatRate = (rate: string): bigint | undefined => {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(rate.trim())
  return match === null
    ? undefined
    : BigInt(match[1] as string) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))
}

export const sameVatRate = (left: string, right: string): boolean =>
  scaledVatRate(left) !== undefined && scaledVatRate(left) === scaledVatRate(right)

const configurationRegistration = (
  configurations: ReadonlyArray<VatConfiguration>,
): boolean | undefined => {
  if (configurations.length === 0) return undefined
  if (configurations.every(({ code, rate, vatCategoryCode, vatExemptionReason }) =>
    code === "RO_NON_VAT"
    && sameVatRate(rate, "0")
    && vatCategoryCode === "O"
    && vatExemptionReason === "Regim special de scutire conform art. 310 din Codul fiscal")) return false
  if (configurations.every(({ code, rate, vatCategoryCode, vatExemptionReason }) =>
    isTaxableVatCode(code)
    && (scaledVatRate(rate) ?? 0n) > 0n
    && vatCategoryCode === "S"
    && vatExemptionReason === null)) return true
  return undefined
}

export const issuerVatRegistrationOn = (issuer: Issuer, date: string): boolean | undefined =>
  configurationRegistration(issuer.vatConfigurations.filter((configuration) =>
    activeOn(configuration, date)))

export const vatRatesForIssuer = (
  catalogue: VatCatalogue,
  issuer: Issuer,
  date: string,
): ReadonlyArray<VatRate> => {
  const registered = issuerVatRegistrationOn(issuer, date)
  return catalogue.rates.filter((rate) => activeOn(rate, date)
    && (registered === true
      ? rate.kind !== "non_vat"
      : registered === false ? rate.kind === "non_vat" : false))
}

export const defaultVatCode = (catalogue: VatCatalogue, issuer: Issuer, date: string): string =>
  vatRatesForIssuer(catalogue, issuer, date).find(({ kind }) => kind === "standard")?.code
  ?? vatRatesForIssuer(catalogue, issuer, date)[0]?.code
  ?? ""

// The code a line gets when a product is chosen: the product's preferred rate
// when the issuer can charge it on the document date, otherwise the issuer's
// default on that date. An Article 310 issuer offers no taxable rate, so the
// exemption always wins over the product's preference.
export const presetVatCode = (
  preferred: string | undefined,
  catalogue: VatCatalogue,
  issuer: Issuer,
  date: string,
): string => preferred !== undefined
  && vatRatesForIssuer(catalogue, issuer, date)
    .some(({ code, kind }) => code === preferred && kind !== "non_vat")
  ? preferred
  : defaultVatCode(catalogue, issuer, date)

export type { NonVatBasis }
