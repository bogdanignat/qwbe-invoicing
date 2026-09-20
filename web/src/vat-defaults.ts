import { ARTICLE_310_EXEMPTION_REASON, isTaxableVatCode, type Issuer, type NonVatBasis, type VatBreakdown, type VatCatalogue, type VatConfiguration, type VatRate } from "./models.ts"

interface DraftTaxLine { readonly vatRateCode: string; readonly vatRate: string }
interface SavedDraftTaxLine extends DraftTaxLine { readonly id: string }

export const romanianCuiPattern = "[1-9][0-9]{1,9}"
export const normalizeRomanianCui = (value: string): string => value.trim().toUpperCase().replace(/^RO/, "")

export const activeOn = (value: { readonly effectiveFrom: string; readonly effectiveTo?: string }, date: string): boolean =>
  value.effectiveFrom <= date && (value.effectiveTo === undefined || date <= value.effectiveTo)

const scaledRate = (rate: string): bigint | undefined => {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(rate.trim())
  return match === null ? undefined : BigInt(match[1] as string) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))
}
const sameRate = (left: string, right: string): boolean => scaledRate(left) !== undefined && scaledRate(left) === scaledRate(right)

const configurationRegistration = (configurations: ReadonlyArray<VatConfiguration>): boolean | undefined => {
  if (configurations.length === 0) return undefined
  if (configurations.every(({ code, rate, vatCategoryCode, vatExemptionReason }) => code === "RO_NON_VAT" && sameRate(rate, "0")
    && vatCategoryCode === "O" && vatExemptionReason === ARTICLE_310_EXEMPTION_REASON)) return false
  if (configurations.every(({ code, rate, vatCategoryCode, vatExemptionReason }) => isTaxableVatCode(code) && (scaledRate(rate) ?? 0n) > 0n
    && vatCategoryCode === "S" && vatExemptionReason === null)) return true
  return undefined
}

export const issuerVatRegistrationOn = (issuer: Issuer, date: string): boolean | undefined => {
  const active = issuer.vatConfigurations.filter((configuration) => activeOn(configuration, date))
  return configurationRegistration(active)
}

interface FallbackVatRegistrationPeriod {
  readonly effectiveFrom: string
  readonly timing: "scheduled" | "expired"
}
export type FallbackVatRegistration = FallbackVatRegistrationPeriod & (
  { readonly registered: true; readonly nonVatBasis?: never }
  | { readonly registered: false; readonly nonVatBasis: NonVatBasis }
)

export const fallbackVatRegistration = (
  configurations: ReadonlyArray<VatConfiguration>, date: string,
): FallbackVatRegistration | undefined => {
  const scheduled = configurations
    .filter(({ effectiveFrom }) => effectiveFrom > date)
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))[0]
  const expired = configurations
    .filter(({ effectiveTo }) => effectiveTo !== undefined && effectiveTo < date)
    .sort((left, right) => (right.effectiveTo as string).localeCompare(left.effectiveTo as string))[0]
  const selected = scheduled ?? expired
  if (selected === undefined) return undefined
  const active = configurations.filter((configuration) => activeOn(configuration, selected.effectiveFrom))
  const registered = configurationRegistration(active)
  if (registered === undefined) return undefined
  const period = { effectiveFrom: selected.effectiveFrom, timing: scheduled === undefined ? "expired" as const : "scheduled" as const }
  return registered ? { registered: true, ...period } : { registered: false, nonVatBasis: "article_310", ...period }
}

export const vatRatesForIssuer = (catalogue: VatCatalogue, issuer: Issuer, date: string): ReadonlyArray<VatRate> => {
  const registered = issuerVatRegistrationOn(issuer, date)
  return catalogue.rates.filter((rate) => activeOn(rate, date)
    && (registered === true ? rate.kind !== "non_vat" : registered === false ? rate.kind === "non_vat" : false))
}

export const defaultVatCode = (catalogue: VatCatalogue, issuer: Issuer, date: string): string =>
  vatRatesForIssuer(catalogue, issuer, date).find(({ kind }) => kind === "standard")?.code
  ?? vatRatesForIssuer(catalogue, issuer, date)[0]?.code
  ?? ""

// The code a line gets when a product is chosen: the product's preferred rate when the issuer can
// charge it on the document date, otherwise the issuer's default on that date. An Article 310
// issuer offers no taxable rate, so the exemption always wins over the product's preference.
export const presetVatCode = (preferred: string | undefined, catalogue: VatCatalogue, issuer: Issuer, date: string): string =>
  preferred !== undefined && vatRatesForIssuer(catalogue, issuer, date).some(({ code, kind }) => code === preferred && kind !== "non_vat")
    ? preferred
    : defaultVatCode(catalogue, issuer, date)

export const hasStaleDraftTax = (
  issueDate: string, lines: ReadonlyArray<DraftTaxLine>, catalogue: VatCatalogue, issuer: Issuer,
): boolean => {
  const rates = vatRatesForIssuer(catalogue, issuer, issueDate)
  return lines.some((line) => !rates.some(({ code, rate }) => code === line.vatRateCode && sameRate(rate, line.vatRate)))
}

export const staleDraftLineIds = (
  issueDate: string, lines: ReadonlyArray<SavedDraftTaxLine>, catalogue: VatCatalogue, issuer: Issuer,
): ReadonlyArray<string> => {
  const rates = vatRatesForIssuer(catalogue, issuer, issueDate)
  return lines
    .filter((line) => !rates.some(({ code, rate }) => code === line.vatRateCode && sameRate(rate, line.vatRate)))
    .map(({ id }) => id)
}

interface VatHistoryPeriod {
  readonly effectiveFrom: string
  readonly effectiveTo?: string
  readonly rates: string
}
export type VatHistoryItem = VatHistoryPeriod & (
  { readonly registered: true; readonly nonVatBasis?: never }
  | { readonly registered: false; readonly nonVatBasis: NonVatBasis }
)

export const vatRegistrationHistory = (
  configurations: ReadonlyArray<VatConfiguration>, catalogue: VatCatalogue,
): ReadonlyArray<VatHistoryItem> => {
  const groups = new Map<string, Array<VatConfiguration>>()
  for (const configuration of configurations) {
    const key = `${configuration.effectiveFrom}:${configuration.effectiveTo ?? ""}`
    groups.set(key, [...(groups.get(key) ?? []), configuration])
  }
  return [...groups.values()].map((group) => {
    const first = group[0] as VatConfiguration
    const registered = configurationRegistration(group)
    if (registered === undefined) throw new Error("Configurație TVA istorică incompletă sau neacceptată.")
    const rates = group.map((configuration) => catalogue.rates.find((rate) => rate.code === configuration.code
      && sameRate(rate.rate, configuration.rate))?.label ?? `${configuration.rate}%`).join(", ")
    const period = { effectiveFrom: first.effectiveFrom, ...(first.effectiveTo === undefined ? {} : { effectiveTo: first.effectiveTo }), rates }
    return registered ? { ...period, registered: true as const } : { ...period, registered: false as const, nonVatBasis: "article_310" as const }
  }).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))
}

export const issuerForIssueDate = (issuer: Issuer, date: string): Issuer & { readonly vatRegistered: boolean } => ({
  ...issuer,
  vatRegistered: issuerVatRegistrationOn(issuer, date) === true,
})

export const vatTreatmentLabel = (treatment: { readonly vatCategoryCode: VatBreakdown["vatCategoryCode"]; readonly rate?: string; readonly vatRate?: string }): string =>
  treatment.vatCategoryCode === "O" ? "Scutit TVA — art. 310" : `TVA ${treatment.rate ?? treatment.vatRate ?? ""}%`
