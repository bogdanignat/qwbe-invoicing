import { ValidationFailure } from "../contracts/failures.ts"
import type { BuyerSnapshot, DocumentSeries, IssuerProfile, PartySnapshot, TaxConfiguration } from "./invoice.ts"

const required = (value: string, field: string, issues: Array<string>) => {
  if (value.trim().length === 0) issues.push(`${field} is required`)
}

const isValidRomanianCui = (value: string): boolean => {
  const match = /^(?:RO)?([1-9]\d{1,9})$/.exec(value)
  if (match === null) return false
  const cui = match[1] as string
  const body = cui.slice(0, -1)
  const key = "753217532"
  const offset = key.length - body.length
  let sum = 0
  for (let index = 0; index < body.length; index += 1) {
    sum += Number(body[index]) * Number(key[offset + index])
  }
  const remainder = (sum * 10) % 11
  return Number(cui.at(-1)) === (remainder === 10 ? 0 : remainder)
}

export const validateParty = (party: PartySnapshot): void => {
  const issues: Array<string> = []
  required(party.legalName, "legalName", issues)
  required(party.address.countryCode, "address.countryCode", issues)
  required(party.address.city, "address.city", issues)
  required(party.address.street, "address.street", issues)
  if (party.taxIdentifier.trim() !== "" && !isValidRomanianCui(party.taxIdentifier)) issues.push("taxIdentifier must be a valid Romanian CUI")
  if (party.address.countryCode !== "RO") issues.push("address.countryCode must be RO")
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

const isValidRomanianCnp = (value: string): boolean => {
  if (!/^\d{13}$/.test(value)) return false
  const key = "279146358279"
  let sum = 0
  for (let index = 0; index < key.length; index += 1) sum += Number(value[index]) * Number(key[index])
  const remainder = sum % 11
  return Number(value.at(-1)) === (remainder === 10 ? 1 : remainder)
}

export const validateBuyer = (buyer: BuyerSnapshot): void => {
  const issues: Array<string> = []
  const partyType: unknown = buyer.partyType
  if (partyType !== "company" && partyType !== "individual") issues.push("partyType must be company or individual")
  try { validateParty({ ...buyer, taxIdentifier: buyer.partyType === "individual" ? "" : buyer.taxIdentifier }) } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  if (buyer.partyType === "company" && buyer.taxIdentifier.trim() === "") issues.push("taxIdentifier is required for company")
  if (buyer.partyType === "individual" && buyer.taxIdentifier !== "" && !isValidRomanianCnp(buyer.taxIdentifier)) {
    issues.push("taxIdentifier must be a valid Romanian CNP")
  }
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
  for (const configuration of configurations) {
    if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(configuration.code)) issues.push("tax configuration code is invalid")
    if (!/^(?:\d|[1-9]\d|100)(?:\.\d{1,2})?$/.test(configuration.rate)) {
      issues.push(`tax configuration ${configuration.code} rate must be between 0 and 100 with at most two decimals`)
    }
    if (configuration.code === "RO_NON_VAT" && Number(configuration.rate) !== 0) {
      issues.push("tax configuration RO_NON_VAT rate must be 0")
    }
    issues.push(...dateIssues(configuration))
  }
  const ordered = [...configurations].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
  ordered.forEach((value, index) => {
    const previous = ordered[index - 1]
    if (previous !== undefined && (previous.effectiveTo === undefined || value.effectiveFrom <= previous.effectiveTo)) {
      issues.push("tax configurations have overlapping effective ranges")
    }
  })
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateIssuer = (issuer: IssuerProfile): void => {
  validateParty(issuer)
  const issues: Array<string> = []
  if (!isValidRomanianCui(issuer.taxIdentifier)) issues.push("taxIdentifier must be a valid Romanian CUI")
  if (issuer.defaultCurrency !== "RON") issues.push("defaultCurrency must be RON")
  if (!Number.isInteger(issuer.defaultPaymentTermDays) || issuer.defaultPaymentTermDays < 0) {
    issues.push("defaultPaymentTermDays must be a non-negative integer")
  }
  try { validateTaxConfigurations(issuer.taxConfigurations) } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  const latest = [...issuer.taxConfigurations]
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0]
  if (latest !== undefined) {
    const nonVat = latest.code === "RO_NON_VAT" && Number(latest.rate) === 0
    const ro = issuer.taxIdentifier.startsWith("RO")
    if (ro && nonVat) {
      issues.push("taxIdentifier with RO prefix requires a VAT-registered tax configuration")
    }
    if (!ro && !nonVat) {
      issues.push("taxIdentifier without RO prefix requires RO_NON_VAT with rate 0")
    }
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateDocumentSeries = (documentSeries: DocumentSeries): void => {
  const issues: Array<string> = []
  const documentType: unknown = documentSeries.documentType
  if (documentType !== "invoice" && documentType !== "proforma") issues.push("documentType must be invoice or proforma")
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(documentSeries.series)) issues.push("series is invalid")
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
