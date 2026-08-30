import { ValidationFailure } from "../contracts/failures.ts"
import type { IssuerProfile, PartySnapshot, TaxConfiguration } from "./invoice.ts"

const required = (value: string, field: string, issues: Array<string>) => {
  if (value.trim().length === 0) issues.push(`${field} is required`)
}

export const validateParty = (party: PartySnapshot): void => {
  const issues: Array<string> = []
  required(party.legalName, "legalName", issues)
  required(party.taxIdentifier, "taxIdentifier", issues)
  required(party.address.countryCode, "address.countryCode", issues)
  required(party.address.city, "address.city", issues)
  required(party.address.street, "address.street", issues)
  if (party.address.countryCode.trim().length !== 2) issues.push("address.countryCode must have two letters")
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateDate = (value: string, field: string): void => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (match === null) throw new ValidationFailure({ issues: [`${field} must be a calendar date in YYYY-MM-DD format`] })
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new ValidationFailure({ issues: [`${field} must be a valid calendar date`] })
  }
}

const dateIssues = (configuration: TaxConfiguration): ReadonlyArray<string> => {
  const issues: Array<string> = []
  try {
    validateDate(configuration.effectiveFrom, `taxConfigurations.${configuration.code}.effectiveFrom`)
    if (configuration.effectiveTo !== undefined) {
      validateDate(configuration.effectiveTo, `taxConfigurations.${configuration.code}.effectiveTo`)
      if (configuration.effectiveTo < configuration.effectiveFrom) issues.push(`tax configuration ${configuration.code} has an invalid range`)
    }
  } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  return issues
}

const validateTaxConfigurations = (configurations: ReadonlyArray<TaxConfiguration>): void => {
  const issues: Array<string> = []
  if (configurations.length === 0) issues.push("taxConfigurations must contain at least one effective tax code")
  const grouped = new Map<string, Array<TaxConfiguration>>()
  for (const configuration of configurations) {
    if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(configuration.code)) issues.push("tax configuration code is invalid")
    if (!/^(?:\d|[1-9]\d|100)(?:\.\d{1,2})?$/.test(configuration.rate)) {
      issues.push(`tax configuration ${configuration.code} rate must be between 0 and 100 with at most two decimals`)
    }
    issues.push(...dateIssues(configuration))
    grouped.set(configuration.code, [...(grouped.get(configuration.code) ?? []), configuration])
  }
  for (const [code, values] of grouped) {
    const ordered = [...values].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
    ordered.forEach((value, index) => {
      const previous = ordered[index - 1]
      if (previous !== undefined && (previous.effectiveTo === undefined || value.effectiveFrom <= previous.effectiveTo)) {
        issues.push(`tax configuration ${code} has overlapping effective ranges`)
      }
    })
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateIssuer = (issuer: IssuerProfile): void => {
  validateParty(issuer)
  const issues: Array<string> = []
  if (!/^[A-Z]{3}$/.test(issuer.defaultCurrency)) issues.push("defaultCurrency must be an ISO 4217 code")
  if (!Number.isInteger(issuer.defaultPaymentTermDays) || issuer.defaultPaymentTermDays < 0) {
    issues.push("defaultPaymentTermDays must be a non-negative integer")
  }
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(issuer.defaultSeries)) issues.push("defaultSeries is invalid")
  try { validateTaxConfigurations(issuer.taxConfigurations) } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const resolveTaxConfiguration = (
  issuer: IssuerProfile,
  code: string,
  issueDate: string,
): TaxConfiguration => {
  const matches = issuer.taxConfigurations.filter((configuration) =>
    configuration.code === code
    && configuration.effectiveFrom <= issueDate
    && (configuration.effectiveTo === undefined || issueDate <= configuration.effectiveTo))
  if (matches.length !== 1) {
    throw new ValidationFailure({ issues: [`taxCode ${code} must resolve to exactly one configuration on ${issueDate}`] })
  }
  return matches[0] as TaxConfiguration
}
