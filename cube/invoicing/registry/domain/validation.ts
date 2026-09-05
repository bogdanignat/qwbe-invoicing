import { ValidationFailure } from "../../contracts/failures.ts"
import { normalizeMoney } from "../../domain/calculation.ts"
import type { IssuerProfile, VatConfiguration } from "../../domain/invoice.ts"
import type { CustomerInput, ProductPresetInput } from "../../domain/inputs.ts"
import { normalizeUnitOfMeasure } from "../../domain/unit-of-measures.ts"
import { isValidRomanianCui, maximumPaymentTermDays, validateBuyer, validateDate, validateParty } from "../../domain/validation.ts"

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
