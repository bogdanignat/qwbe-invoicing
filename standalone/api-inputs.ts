import {
  ValidationFailure,
  type AddDraftLineInput,
  type AuthoringDocumentInput,
  type AuthoringProformaInput,
  type BuyerSnapshot,
  type ConfigureDocumentSeriesInput,
  type ConfigureIssuerInput,
  type CreateCustomerInput,
  type CreateDraftInput,
  type ProductPresetInput,
  type UpdateDraftInput,
  type UpdateDraftLineInput,
} from "../cube/invoicing/index.ts"

type JsonObject = Readonly<Record<string, unknown>>

const object = (value: unknown): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationFailure({ issues: ["request body must be a JSON object"] })
  }
  return value as JsonObject
}
const text = (value: unknown, field: string): string => {
  if (typeof value !== "string") throw new ValidationFailure({ issues: [`${field} must be a string`] })
  return value
}
const optionalText = (value: unknown, field: string): string | undefined => value === undefined ? undefined : text(value, field)
const optionalNullableText = (value: unknown, field: string): string | null | undefined =>
  value === undefined || value === null ? value : text(value, field)
const integer = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new ValidationFailure({ issues: [`${field} must be an integer`] })
  return value
}
const address = (value: unknown) => {
  const input = object(value)
  const county = optionalText(input.county, "address.county")
  const postalCode = optionalText(input.postalCode, "address.postalCode")
  return {
    countryCode: text(input.countryCode, "address.countryCode"), city: text(input.city, "address.city"),
    street: text(input.street, "address.street"), ...(county === undefined ? {} : { county }),
    ...(postalCode === undefined ? {} : { postalCode }),
  }
}
const buyer = (value: unknown): BuyerSnapshot => {
  const input = object(value)
  const partyType = text(input.partyType, "partyType")
  if (partyType !== "company" && partyType !== "individual") {
    throw new ValidationFailure({ issues: ["partyType must be company or individual"] })
  }
  return {
    partyType, legalName: text(input.legalName, "legalName"),
    taxIdentifier: text(input.taxIdentifier, "taxIdentifier").trim().toUpperCase(), address: address(input.address),
  }
}
const buyerSource = (input: JsonObject) => {
  const hasId = input.customerId !== undefined
  const hasInline = input.customer !== undefined
  if (hasId === hasInline) throw new ValidationFailure({ issues: ["exactly one of customerId or customer is required"] })
  return hasId ? { customerId: text(input.customerId, "customerId") } : { customer: buyer(input.customer) }
}

export const issuerInput = (value: unknown): ConfigureIssuerInput => {
  const input = object(value)
  if (!Array.isArray(input.taxConfigurations)) throw new ValidationFailure({ issues: ["taxConfigurations must be an array"] })
  return {
    legalName: text(input.legalName, "legalName"), taxIdentifier: text(input.taxIdentifier, "taxIdentifier").trim().toUpperCase(),
    address: address(input.address), defaultCurrency: text(input.defaultCurrency, "defaultCurrency"),
    defaultPaymentTermDays: integer(input.defaultPaymentTermDays, "defaultPaymentTermDays"),
    taxConfigurations: input.taxConfigurations.map((item) => {
      const tax = object(item)
      if (tax.category !== undefined && tax.category !== "standard") {
        throw new ValidationFailure({ issues: ["taxConfigurations.category must be standard"] })
      }
      const effectiveTo = optionalText(tax.effectiveTo, "taxConfigurations.effectiveTo")
      return { code: text(tax.code, "taxConfigurations.code"), category: "standard" as const,
        rate: text(tax.rate, "taxConfigurations.rate"), effectiveFrom: text(tax.effectiveFrom, "taxConfigurations.effectiveFrom"),
        ...(effectiveTo === undefined ? {} : { effectiveTo }) }
    }),
  }
}
export const customerInput = (value: unknown): CreateCustomerInput => {
  const input = object(value)
  const defaultPaymentTermDays = input.defaultPaymentTermDays === undefined
    ? undefined
    : integer(input.defaultPaymentTermDays, "defaultPaymentTermDays")
  return { ...buyer(input), ...(defaultPaymentTermDays === undefined ? {} : { defaultPaymentTermDays }) }
}
export const productPresetInput = (value: unknown): ProductPresetInput => {
  const input = object(value)
  return { description: text(input.description, "description"), unitPrice: text(input.unitPrice, "unitPrice") }
}
export const documentSeriesInput = (value: unknown): ConfigureDocumentSeriesInput => {
  const input = object(value)
  const documentType = text(input.documentType, "documentType")
  if (documentType !== "invoice" && documentType !== "proforma") throw new ValidationFailure({ issues: ["documentType must be invoice or proforma"] })
  return { documentType, series: text(input.series, "series") }
}
export const draftInput = (value: unknown): CreateDraftInput => {
  const input = object(value)
  const currency = optionalText(input.currency, "currency")
  const dueDate = optionalNullableText(input.dueDate, "dueDate")
  return { ...buyerSource(input), series: text(input.series, "series"), issueDate: text(input.issueDate, "issueDate"),
    ...(currency === undefined ? {} : { currency }), ...(dueDate === undefined ? {} : { dueDate }) }
}
export const updateDraftInput = (draftId: string, value: unknown): UpdateDraftInput => {
  const input = object(value)
  const dueDate = optionalNullableText(input.dueDate, "dueDate")
  return { ...buyerSource(input), draftId, issueDate: text(input.issueDate, "issueDate"),
    ...(dueDate === undefined ? {} : { dueDate }) }
}
const lineFields = (draftId: string, value: unknown): AddDraftLineInput => {
  const input = object(value)
  return { draftId, description: text(input.description, "description"), quantity: text(input.quantity, "quantity"),
    unitPrice: text(input.unitPrice, "unitPrice"), taxCode: text(input.taxCode, "taxCode") }
}
export const lineInput = lineFields
export const updateLineInput = (draftId: string, lineId: string, value: unknown): UpdateDraftLineInput => ({
  ...lineFields(draftId, value), lineId,
})
export const paymentInput = (invoiceId: string, value: unknown) => {
  const input = object(value)
  const externalReference = optionalText(input.externalReference, "externalReference")
  const note = optionalText(input.note, "note")
  return { invoiceId, amount: text(input.amount, "amount"), currency: text(input.currency, "currency"),
    paymentDate: text(input.paymentDate, "paymentDate"), method: text(input.method, "method"),
    ...(externalReference === undefined ? {} : { externalReference }), ...(note === undefined ? {} : { note }) }
}
export const correctionInput = (originalInvoiceId: string, value: unknown) => {
  const input = object(value)
  const issueDate = optionalText(input.issueDate, "issueDate")
  return { originalInvoiceId, reason: text(input.reason, "reason"), ...(issueDate === undefined ? {} : { issueDate }) }
}
export const issueProformaInput = (draftId: string, value: unknown) => {
  const input = object(value)
  return { draftId, series: text(input.series, "series") }
}
const rawLines = (value: unknown): AuthoringDocumentInput["lines"] => {
  if (!Array.isArray(value)) throw new ValidationFailure({ issues: ["lines must be an array"] })
  return value.map((value) => {
    const line = object(value)
    return { description: text(line.description, "lines.description"), quantity: text(line.quantity, "lines.quantity"),
      unitPrice: text(line.unitPrice, "lines.unitPrice"), taxCode: text(line.taxCode, "lines.taxCode") }
  })
}
const authoring = (value: unknown): AuthoringDocumentInput => {
  const input = object(value)
  const dueDate = optionalNullableText(input.dueDate, "dueDate")
  const currency = text(input.currency, "currency")
  if (currency !== "RON") throw new ValidationFailure({ issues: ["currency must be RON"] })
  return { ...buyerSource(input), series: text(input.series, "series"), issueDate: text(input.issueDate, "issueDate"), currency,
    ...(dueDate === undefined ? {} : { dueDate }), lines: rawLines(input.lines) }
}
export const authoringInvoiceInput = authoring
export const authoringProformaInput = (value: unknown): AuthoringProformaInput => {
  const input = object(value)
  return { ...authoring(input), proformaSeries: text(input.proformaSeries, "proformaSeries") }
}
export const emptyInput = (value: unknown): Record<string, never> => {
  object(value)
  return {}
}
