import { ValidationFailure } from "../contracts/failures.ts"
import type { BuyerSnapshot, CustomerInput, DocumentSeries, DocumentSource, IssuerProfile, PartySnapshot, ProductPresetInput, VatConfiguration } from "./invoice.ts"
import { normalizeMoney } from "./calculation.ts"
import { normalizeUnitOfMeasure } from "./unit-of-measures.ts"

const maximumPaymentTermDays = 3650

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
  required(party.name, "name", issues)
  required(party.address.countryCode, "address.countryCode", issues)
  required(party.address.city, "address.city", issues)
  required(party.address.street, "address.street", issues)
  if (party.fiscalIdentifier.trim() !== "" && !isValidRomanianCui(party.fiscalIdentifier)) issues.push("fiscalIdentifier must be a valid Romanian CUI")
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
  try { validateParty({ ...buyer, fiscalIdentifier: buyer.partyType === "individual" ? "" : buyer.fiscalIdentifier }) } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  if (buyer.partyType === "company" && buyer.fiscalIdentifier.trim() === "") issues.push("fiscalIdentifier is required for company")
  if (buyer.partyType === "individual" && buyer.fiscalIdentifier !== "" && !isValidRomanianCnp(buyer.fiscalIdentifier)) {
    issues.push("fiscalIdentifier must be a valid Romanian CNP")
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateCustomer = (customer: CustomerInput): void => {
  validateBuyer(customer)
  if (customer.defaultPaymentTermDays !== undefined
    && (!Number.isInteger(customer.defaultPaymentTermDays) || customer.defaultPaymentTermDays < 0
      || customer.defaultPaymentTermDays > maximumPaymentTermDays)) {
    throw new ValidationFailure({ issues: [`defaultPaymentTermDays must be an integer between 0 and ${String(maximumPaymentTermDays)}`] })
  }
}

export const normalizeProductPreset = (input: ProductPresetInput): ProductPresetInput => {
  const description = input.description.trim()
  if (description.length === 0) throw new ValidationFailure({ issues: ["description is required"] })
  return { description, unitPrice: normalizeMoney(input.unitPrice, "unitPrice"), unitOfMeasure: normalizeUnitOfMeasure(input.unitOfMeasure) }
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
    if (configuration.code === "RO_NON_VAT" && Number(configuration.rate) !== 0) {
      issues.push("vat configuration RO_NON_VAT rate must be 0")
    }
    issues.push(...dateIssues(configuration))
  }
  const ordered = [...configurations].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
  ordered.forEach((value, index) => {
    const previous = ordered[index - 1]
    if (previous !== undefined && (previous.effectiveTo === undefined || value.effectiveFrom <= previous.effectiveTo)) {
      issues.push("vat configurations have overlapping effective ranges")
    }
  })
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

export const validateIssuer = (issuer: IssuerProfile): void => {
  validateParty(issuer)
  const issues: Array<string> = []
  if (!isValidRomanianCui(issuer.fiscalIdentifier)) issues.push("fiscalIdentifier must be a valid Romanian CUI")
  if (issuer.defaultCurrency !== "RON") issues.push("defaultCurrency must be RON")
  if (!Number.isInteger(issuer.defaultPaymentTermDays) || issuer.defaultPaymentTermDays < 0
    || issuer.defaultPaymentTermDays > maximumPaymentTermDays) {
    issues.push(`defaultPaymentTermDays must be an integer between 0 and ${String(maximumPaymentTermDays)}`)
  }
  try { validateVatConfigurations(issuer.vatConfigurations) } catch (error) {
    if (error instanceof ValidationFailure) issues.push(...error.issues)
  }
  const latest = [...issuer.vatConfigurations]
    .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0]
  if (latest !== undefined) {
    const nonVat = latest.code === "RO_NON_VAT" && Number(latest.rate) === 0
    const ro = issuer.fiscalIdentifier.startsWith("RO")
    if (ro && nonVat) {
      issues.push("fiscalIdentifier with RO prefix requires a VAT-registered vat configuration")
    }
    if (!ro && !nonVat) {
      issues.push("fiscalIdentifier without RO prefix requires RO_NON_VAT with rate 0")
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

export const validateDocumentSource = (source: DocumentSource): void => {
  const issues: Array<string> = []
  for (const [field, value, maximum] of [
    ["source.app", source.app, 100],
    ["source.kind", source.kind, 100],
    ["source.id", source.id, 255],
  ] as const) {
    if (value.trim().length === 0) issues.push(`${field} is required`)
    if (value !== value.trim()) issues.push(`${field} must not have surrounding whitespace`)
    if (value.length > maximum) issues.push(`${field} must be at most ${String(maximum)} characters`)
    if (/\p{Cc}/u.test(value)) issues.push(`${field} must not contain control characters`)
  }
  if (issues.length > 0) throw new ValidationFailure({ issues })
}

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
