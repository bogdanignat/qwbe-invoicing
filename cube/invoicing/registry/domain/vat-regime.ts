import { ValidationFailure } from "../../contracts/failures.ts"
import type { DraftLine, IssuerProfile, VatConfiguration } from "../../domain/invoice.ts"
import type { VatChange } from "../../domain/inputs.ts"

export interface VatRate {
  readonly code: string
  readonly rate: string
  readonly kind: "standard" | "reduced" | "non_vat"
  readonly label: string
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

export interface VatRegistration {
  readonly registered: boolean
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}

// Official scope deliberately bounded to the immediately preceding and current Romanian rate sets.
// Sources checked 2026-09-12: Cod fiscal art. 291, consolidations 2025-04-04 and 2025-08-01;
// Legea 141/2025 art. II pct. 42-43 and art. VII (effective 2025-08-01).
export const romanianVatRates: ReadonlyArray<VatRate> = [
  { code: "RO_STANDARD", rate: "19.00", kind: "standard", label: "TVA standard 19%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { code: "RO_REDUCED", rate: "9.00", kind: "reduced", label: "TVA redus 9%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { code: "RO_REDUCED_5", rate: "5.00", kind: "reduced", label: "TVA redus 5%", effectiveFrom: "2025-01-01", effectiveTo: "2025-07-31" },
  { code: "RO_STANDARD", rate: "21.00", kind: "standard", label: "TVA standard 21%", effectiveFrom: "2025-08-01" },
  { code: "RO_REDUCED", rate: "11.00", kind: "reduced", label: "TVA redus 11%", effectiveFrom: "2025-08-01" },
  { code: "RO_NON_VAT", rate: "0.00", kind: "non_vat", label: "Neplătitor de TVA", effectiveFrom: "2025-01-01" },
]

const activeOn = (value: { readonly effectiveFrom: string; readonly effectiveTo?: string }, date: string): boolean =>
  value.effectiveFrom <= date && (value.effectiveTo === undefined || date <= value.effectiveTo)

const scaledRate = (rate: string): bigint | undefined => {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(rate.trim())
  return match === null ? undefined : BigInt(match[1] as string) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"))
}
const sameRate = (left: string, right: string): boolean => scaledRate(left) !== undefined && scaledRate(left) === scaledRate(right)

export const vatRatesOn = (date: string): ReadonlyArray<VatRate> => romanianVatRates.filter((rate) => activeOn(rate, date))

export const inferVatRegistration = (countryCode: string, fiscalIdentifier: string): boolean | undefined => {
  if (countryCode.trim().toUpperCase() !== "RO") return undefined
  const identifier = fiscalIdentifier.trim().toUpperCase()
  if (/^RO\d+$/.test(identifier)) return true
  if (/^\d+$/.test(identifier)) return false
  return undefined
}

const vatRegistrationOn = (
  configurations: ReadonlyArray<VatConfiguration>, date: string,
): VatRegistration | undefined => {
  const active = configurations.filter((configuration) => activeOn(configuration, date))
  if (active.length === 0) return undefined
  const nonVat = active.some((configuration) => configuration.code === "RO_NON_VAT" && sameRate(configuration.rate, "0"))
  const selected = active[0] as VatConfiguration
  return { registered: !nonVat, effectiveFrom: selected.effectiveFrom, ...(selected.effectiveTo === undefined ? {} : { effectiveTo: selected.effectiveTo }) }
}

export const currentVatRegistration = (
  configurations: ReadonlyArray<VatConfiguration>, date: string,
): VatRegistration | undefined => {
  return vatRegistrationOn(configurations, date)
}

const previousDay = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

const configurationsFor = (change: VatChange): ReadonlyArray<VatConfiguration> => {
  const rates = vatRatesOn(change.effectiveFrom)
  if (rates.length === 0) throw new ValidationFailure({ issues: [`VAT catalogue does not cover ${change.effectiveFrom}`] })
  return romanianVatRates
    .filter(({ kind }) => change.registered ? kind !== "non_vat" : kind === "non_vat")
    .filter(({ effectiveTo }) => effectiveTo === undefined || effectiveTo >= change.effectiveFrom)
    .map(({ code, rate, effectiveFrom, effectiveTo }) => ({
      code,
      rate,
      effectiveFrom: effectiveFrom > change.effectiveFrom ? effectiveFrom : change.effectiveFrom,
      ...(effectiveTo === undefined ? {} : { effectiveTo }),
    }))
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
}

export const scheduleVatRegistration = (
  configurations: ReadonlyArray<VatConfiguration>, change: VatChange,
): ReadonlyArray<VatConfiguration> => {
  if (vatRegistrationOn(configurations, change.effectiveFrom)?.registered === change.registered) return configurations
  const next = configurationsFor(change)
  const kept = configurations.filter(({ effectiveFrom }) => effectiveFrom < change.effectiveFrom)
  const closed = kept.map((configuration) => activeOn(configuration, change.effectiveFrom)
    ? { ...configuration, effectiveTo: previousDay(change.effectiveFrom) }
    : configuration)
  return [...closed, ...next]
}

export const validateVatForIssuance = (
  issuer: IssuerProfile, issueDate: string, lines: ReadonlyArray<Pick<DraftLine, "vatRateCode" | "vatRate">>,
): void => {
  const registration = vatRegistrationOn(issuer.vatConfigurations, issueDate)
  const legal = vatRatesOn(issueDate)
  const issues: Array<string> = []
  if (registration === undefined) issues.push(`issuer VAT registration must be configured on ${issueDate}`)
  for (const line of lines) {
    const pair = legal.find(({ code, rate }) => code === line.vatRateCode && sameRate(rate, line.vatRate))
    if (pair === undefined) issues.push(`VAT pair ${line.vatRateCode}/${line.vatRate} is not supported on ${issueDate}`)
    else if (registration?.registered === true && pair.kind === "non_vat") issues.push(`VAT pair ${line.vatRateCode}/${line.vatRate} requires a non-VAT issuer on ${issueDate}`)
    else if (registration?.registered === false && pair.kind !== "non_vat") issues.push(`VAT pair ${line.vatRateCode}/${line.vatRate} requires a VAT-registered issuer on ${issueDate}`)
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}
