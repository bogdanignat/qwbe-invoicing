import { ValidationFailure } from "../../contracts/failures.ts"
import type { VatConfiguration } from "../../domain/invoice.ts"
import type { IssuerProfile } from "./issuer.ts"
import { maximumPaymentTermDays, validateDate, validateVatTreatment } from "../../domain/validation.ts"
import { normalizeIssuerDetails } from "./issuer-details.ts"
import { isValidRomanianCui, validateParty } from "../../parties/index.ts"

export const resolveVatConfiguration = (
  issuer: IssuerProfile,
  code: string,
  issueDate: string,
): VatConfiguration => {
  const matches = issuer.vatConfigurations.filter((configuration) =>
    configuration.code === code
    && configuration.effectiveFrom <= issueDate
    && (configuration.effectiveTo === undefined || issueDate <= configuration.effectiveTo))
  if (matches.length !== 1) {
    throw new ValidationFailure({ issues: [`vatRateCode ${code} must resolve to exactly one configuration on ${issueDate}`] })
  }
  return matches[0] as VatConfiguration
}

export const normalizeBrandingText = (value: string | null): string | null => {
  if (value === null) return null
  const text = value.trim()
  if (text.length === 0) return null
  if (Array.from(text).length > 80) throw new ValidationFailure({ issues: ["branding.text must be at most 80 Unicode codepoints"] })
  if (/\p{C}/u.test(text)) throw new ValidationFailure({ issues: ["branding.text must not contain control characters"] })
  return text
}

const dateIssues = (configuration: VatConfiguration): ReadonlyArray<string> => {
  const issues: Array<string> = []
  try {
    validateDate(configuration.effectiveFrom, `vatConfigurations.${configuration.code}.effectiveFrom`)
    if (configuration.effectiveTo !== undefined) {
      validateDate(configuration.effectiveTo, `vatConfigurations.${configuration.code}.effectiveTo`)
      if (configuration.effectiveTo < configuration.effectiveFrom) issues.push(`vat configuration ${configuration.code} has an invalid range`)
    }
  } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  return issues
}

const validateVatConfigurations = (configurations: ReadonlyArray<VatConfiguration>): void => {
  const issues: Array<string> = []
  if (configurations.length === 0) issues.push("vatConfigurations must contain at least one effective vat code")
  for (const configuration of configurations) {
    if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(configuration.code)) issues.push("vat configuration code is invalid")
    if (!/^(?:\d|[1-9]\d|100)(?:\.\d{1,2})?$/.test(configuration.rate)) {
      issues.push(`vat configuration ${configuration.code} rate must be between 0 and 100 with at most two decimals`)
    }
    try { validateVatTreatment(configuration.code, configuration.rate, configuration.vatCategoryCode, configuration.vatExemptionReason) }
    catch (error) { if (error instanceof ValidationFailure) issues.push(...error.issues); else throw error }
    issues.push(...dateIssues(configuration))
  }
  const ordered = [...configurations].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
  ordered.forEach((value, index) => {
    if (ordered.slice(0, index).some((previous) => (
      previous.code === value.code || previous.code === "RO_NON_VAT" || value.code === "RO_NON_VAT"
    ) && (previous.effectiveTo === undefined || value.effectiveFrom <= previous.effectiveTo))) {
      issues.push("vat configurations have overlapping effective ranges")
    }
  })
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateIssuerProfile = (issuer: Omit<IssuerProfile, "vatConfigurations">): void => {
  validateParty(issuer)
  normalizeIssuerDetails(issuer)
  const issues: Array<string> = []
  if (!isValidRomanianCui(issuer.fiscalIdentifier)) issues.push("fiscalIdentifier must be a valid Romanian CUI")
  if (issuer.defaultCurrency !== "RON") issues.push("defaultCurrency must be RON")
  if (!Number.isInteger(issuer.defaultPaymentTermDays) || issuer.defaultPaymentTermDays < 0
    || issuer.defaultPaymentTermDays > maximumPaymentTermDays) {
    issues.push(`defaultPaymentTermDays must be an integer between 0 and ${String(maximumPaymentTermDays)}`)
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateIssuer = (issuer: IssuerProfile): void => {
  validateIssuerProfile(issuer)
  validateVatConfigurations(issuer.vatConfigurations)
}
