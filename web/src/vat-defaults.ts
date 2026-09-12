import type { Issuer, VatCatalogue, VatConfiguration, VatRate } from "./models.ts"

interface DraftTaxLine { readonly vatRateCode: string; readonly vatRate: string }
interface SavedDraftTaxLine extends DraftTaxLine { readonly id: string }

export const romanianCuiPattern = "(?:RO)?[1-9][0-9]{1,9}"
export const normalizeRomanianCui = (value: string): string => value.trim().toUpperCase()

export const shouldApplyVatInference = (input: {
  readonly requestedFiscalIdentifier: string
  readonly currentFiscalIdentifier: string
  readonly requestIsCurrent: boolean
  readonly manuallySelectedVat: boolean
}): boolean => input.requestIsCurrent
  && !input.manuallySelectedVat
  && normalizeRomanianCui(input.requestedFiscalIdentifier) === normalizeRomanianCui(input.currentFiscalIdentifier)

const activeOn = (value: { readonly effectiveFrom: string; readonly effectiveTo?: string }, date: string): boolean =>
  value.effectiveFrom <= date && (value.effectiveTo === undefined || date <= value.effectiveTo)

const scaledRate = (rate: string): bigint | undefined => {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(rate.trim())
  return match === null ? undefined : BigInt(match[1] as string) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))
}
const sameRate = (left: string, right: string): boolean => scaledRate(left) !== undefined && scaledRate(left) === scaledRate(right)

export const issuerVatRegistrationOn = (issuer: Issuer, date: string): boolean | undefined => {
  const active = issuer.vatConfigurations.filter((configuration) => activeOn(configuration, date))
  if (active.length === 0) return undefined
  return !active.some(({ code, rate }) => code === "RO_NON_VAT" && sameRate(rate, "0"))
}

export interface FallbackVatRegistration {
  readonly registered: boolean
  readonly effectiveFrom: string
  readonly timing: "scheduled" | "expired"
}

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
  return {
    registered: !active.some(({ code, rate }) => code === "RO_NON_VAT" && sameRate(rate, "0")),
    effectiveFrom: selected.effectiveFrom,
    timing: scheduled === undefined ? "expired" : "scheduled",
  }
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

export interface VatHistoryItem {
  readonly effectiveFrom: string
  readonly effectiveTo?: string
  readonly registered: boolean
  readonly rates: string
}

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
    const registered = !group.some(({ code, rate }) => code === "RO_NON_VAT" && sameRate(rate, "0"))
    const rates = group.map((configuration) => catalogue.rates.find((rate) => rate.code === configuration.code
      && sameRate(rate.rate, configuration.rate))?.label ?? `${configuration.rate}%`).join(", ")
    return { effectiveFrom: first.effectiveFrom, ...(first.effectiveTo === undefined ? {} : { effectiveTo: first.effectiveTo }), registered, rates }
  }).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))
}
