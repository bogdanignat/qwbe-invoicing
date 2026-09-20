import { ValidationFailure } from "../../contracts/failures.ts"
import type { DraftLine, VatConfiguration } from "../../domain/invoice.ts"
import type { IssuerProfile, VatChange } from "./issuer.ts"
import { validateVatTreatment } from "../../domain/validation.ts"
import { activeOn, romanianVatRates, vatRatesOn } from "./vat-catalogue.ts"

type VatRegistrationPeriod = {
  readonly effectiveFrom: string
  readonly effectiveTo?: string
}
export type VatRegistration = VatRegistrationPeriod & (
  | { readonly registered: true; readonly nonVatBasis?: never }
  | { readonly registered: false; readonly nonVatBasis: "article_310" }
)

const sameRate = (left: string, right: string): boolean => Number(left) === Number(right)

const vatRegistrationOn = (
  configurations: ReadonlyArray<VatConfiguration>, date: string,
): VatRegistration | undefined => {
  const active = configurations.filter((configuration) => activeOn(configuration, date))
  if (active.length === 0) return undefined
  active.forEach(({ code, rate, vatCategoryCode, vatExemptionReason }) => {
    validateVatTreatment(code, rate, vatCategoryCode, vatExemptionReason)
  })
  const nonVat = active.every((configuration) => configuration.code === "RO_NON_VAT")
  if (!nonVat && active.some((configuration) => configuration.code === "RO_NON_VAT")) {
    throw new ValidationFailure({ issues: [`issuer VAT configuration is inconsistent on ${date}`] })
  }
  const selected = active[0] as VatConfiguration
  const period = { effectiveFrom: selected.effectiveFrom, ...(selected.effectiveTo === undefined ? {} : { effectiveTo: selected.effectiveTo }) }
  return nonVat ? { registered: false, nonVatBasis: "article_310", ...period } : { registered: true, ...period }
}

export const currentVatRegistration = vatRegistrationOn

const previousDay = (date: string): string => {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() - 1)
  return value.toISOString().slice(0, 10)
}

const validateVatChange = (change: VatChange): void => {
  const runtime = change as { readonly registered: unknown; readonly nonVatBasis?: unknown }
  const hasBasis = Object.prototype.hasOwnProperty.call(change, "nonVatBasis")
  if ((runtime.registered !== true && runtime.registered !== false)
    || (runtime.registered ? hasBasis : !hasBasis || runtime.nonVatBasis !== "article_310")) {
    throw new ValidationFailure({ issues: [runtime.registered === true
      ? "nonVatBasis is not allowed for a VAT-registered issuer"
      : "nonVatBasis must be article_310 for a non-VAT issuer"] })
  }
}

const configurationsFor = (change: VatChange): ReadonlyArray<VatConfiguration> => {
  const rates = vatRatesOn(change.effectiveFrom)
  if (rates.length === 0) throw new ValidationFailure({ issues: [`VAT catalogue does not cover ${change.effectiveFrom}`] })
  return romanianVatRates
    .filter(({ kind }) => change.registered ? kind !== "non_vat" : kind === "non_vat")
    .filter(({ effectiveTo }) => effectiveTo === undefined || effectiveTo >= change.effectiveFrom)
    .map(({ code, rate, vatCategoryCode, vatExemptionReason, effectiveFrom, effectiveTo }) => ({
      code, rate, vatCategoryCode, vatExemptionReason,
      effectiveFrom: effectiveFrom > change.effectiveFrom ? effectiveFrom : change.effectiveFrom,
      ...(effectiveTo === undefined ? {} : { effectiveTo }),
    }))
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
}

export const scheduleVatRegistration = (
  configurations: ReadonlyArray<VatConfiguration>, change: VatChange,
): ReadonlyArray<VatConfiguration> => {
  validateVatChange(change)
  configurations.forEach(({ code, rate, vatCategoryCode, vatExemptionReason }) => {
    validateVatTreatment(code, rate, vatCategoryCode, vatExemptionReason)
  })
  if (vatRegistrationOn(configurations, change.effectiveFrom)?.registered === change.registered) return configurations
  const next = configurationsFor(change)
  const kept = configurations.filter(({ effectiveFrom }) => effectiveFrom < change.effectiveFrom)
  const closed = kept.map((configuration) => activeOn(configuration, change.effectiveFrom)
    ? { ...configuration, effectiveTo: previousDay(change.effectiveFrom) }
    : configuration)
  return [...closed, ...next]
}

export const validateVatForIssuance = (
  issuer: IssuerProfile, issueDate: string,
  lines: ReadonlyArray<Pick<DraftLine, "vatRateCode" | "vatRate" | "vatCategoryCode" | "vatExemptionReason">>,
): void => {
  const registration = vatRegistrationOn(issuer.vatConfigurations, issueDate)
  const legal = vatRatesOn(issueDate)
  if (registration === undefined) throw new ValidationFailure({ issues: [`issuer VAT registration must be configured on ${issueDate}`] })
  for (const line of lines) {
    validateVatTreatment(line.vatRateCode, line.vatRate, line.vatCategoryCode, line.vatExemptionReason)
    const pair = legal.find(({ code, rate, vatCategoryCode, vatExemptionReason }) => code === line.vatRateCode
      && sameRate(rate, line.vatRate) && vatCategoryCode === line.vatCategoryCode && vatExemptionReason === line.vatExemptionReason)
    const issue = pair === undefined ? `VAT pair ${line.vatRateCode}/${line.vatRate} is not supported on ${issueDate}`
      : registration.registered && pair.kind === "non_vat" ? `VAT pair ${line.vatRateCode}/${line.vatRate} requires a non-VAT issuer on ${issueDate}`
      : !registration.registered && pair.kind !== "non_vat" ? `VAT pair ${line.vatRateCode}/${line.vatRate} requires a VAT-registered issuer on ${issueDate}` : undefined
    if (issue !== undefined) throw new ValidationFailure({ issues: [issue] })
  }
}
