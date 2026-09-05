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
  type DocumentSource,
  type PageRequest,
  type ProductPresetInput,
  type UnitOfMeasure,
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
    partyType, name: text(input.name, "name"),
    fiscalIdentifier: text(input.fiscalIdentifier, "fiscalIdentifier").trim().toUpperCase(), address: address(input.address),
  }
}
const unitOfMeasure = (value: unknown): UnitOfMeasure => {
  const input = object(value)
  return { code: text(input.code, "unitOfMeasure.code"), name: text(input.name, "unitOfMeasure.name") }
}
const documentSource = (value: unknown): DocumentSource => {
  const input = object(value)
  return { app: text(input.app, "source.app"), kind: text(input.kind, "source.kind"), id: text(input.id, "source.id") }
}
const optionalDocumentSource = (value: unknown): DocumentSource | undefined =>
  value === undefined ? undefined : documentSource(value)
const buyerSource = (input: JsonObject) => {
  const hasId = input.customerId !== undefined
  const hasInline = input.customer !== undefined
  if (hasId === hasInline) throw new ValidationFailure({ issues: ["exactly one of customerId or customer is required"] })
  return hasId ? { customerId: text(input.customerId, "customerId") } : { customer: buyer(input.customer) }
}

export const issuerInput = (value: unknown): ConfigureIssuerInput => {
  const input = object(value)
  if (!Array.isArray(input.vatConfigurations)) throw new ValidationFailure({ issues: ["vatConfigurations must be an array"] })
  return {
    name: text(input.name, "name"), fiscalIdentifier: text(input.fiscalIdentifier, "fiscalIdentifier").trim().toUpperCase(),
    address: address(input.address), defaultCurrency: text(input.defaultCurrency, "defaultCurrency"),
    defaultPaymentTermDays: integer(input.defaultPaymentTermDays, "defaultPaymentTermDays"),
    vatConfigurations: input.vatConfigurations.map((item) => {
      const tax = object(item)
      const effectiveTo = optionalText(tax.effectiveTo, "vatConfigurations.effectiveTo")
      return { code: text(tax.code, "vatConfigurations.code"), rate: text(tax.rate, "vatConfigurations.rate"), effectiveFrom: text(tax.effectiveFrom, "vatConfigurations.effectiveFrom"),
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
  return { description: text(input.description, "description"), unitPrice: text(input.unitPrice, "unitPrice"),
    unitOfMeasure: unitOfMeasure(input.unitOfMeasure) }
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
  const source = optionalDocumentSource(input.source)
  return { ...buyerSource(input), ...(source === undefined ? {} : { source }), series: text(input.series, "series"), issueDate: text(input.issueDate, "issueDate"),
    ...(currency === undefined ? {} : { currency }), ...(dueDate === undefined ? {} : { dueDate }) }
}
export const updateDraftInput = (draftId: string, value: unknown): UpdateDraftInput => {
  const input = object(value)
  const dueDate = optionalNullableText(input.dueDate, "dueDate")
  const source = input.source === null ? null : optionalDocumentSource(input.source)
  return { ...buyerSource(input), draftId, ...(source === undefined ? {} : { source }), issueDate: text(input.issueDate, "issueDate"),
    ...(dueDate === undefined ? {} : { dueDate }) }
}
const lineFields = (draftId: string, value: unknown): AddDraftLineInput => {
  const input = object(value)
  return { draftId, description: text(input.description, "description"), quantity: text(input.quantity, "quantity"),
    unitPrice: text(input.unitPrice, "unitPrice"), unitOfMeasure: unitOfMeasure(input.unitOfMeasure),
    vatRateCode: text(input.vatRateCode, "vatRateCode") }
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
  const source = optionalDocumentSource(input.source)
  return { originalInvoiceId, reason: text(input.reason, "reason"),
    ...(issueDate === undefined ? {} : { issueDate }), ...(source === undefined ? {} : { source }) }
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
      unitPrice: text(line.unitPrice, "lines.unitPrice"), unitOfMeasure: unitOfMeasure(line.unitOfMeasure),
      vatRateCode: text(line.vatRateCode, "lines.vatRateCode") }
  })
}
const authoring = (value: unknown): AuthoringDocumentInput => {
  const input = object(value)
  const dueDate = optionalNullableText(input.dueDate, "dueDate")
  const source = optionalDocumentSource(input.source)
  const currency = text(input.currency, "currency")
  if (currency !== "RON") throw new ValidationFailure({ issues: ["currency must be RON"] })
  return { ...buyerSource(input), ...(source === undefined ? {} : { source }), series: text(input.series, "series"), issueDate: text(input.issueDate, "issueDate"), currency,
    ...(dueDate === undefined ? {} : { dueDate }), lines: rawLines(input.lines) }
}
export const authoringInvoiceInput = authoring
export const authoringProformaInput = (value: unknown): AuthoringProformaInput => {
  const input = object(value)
  return { ...authoring(input), proformaSeries: text(input.proformaSeries, "proformaSeries") }
}
export const pageRequest = (params: URLSearchParams): PageRequest | undefined => {
  if (params.getAll("limit").length > 1 || params.getAll("cursor").length > 1) {
    throw new ValidationFailure({ issues: ["limit and cursor must be supplied at most once"] })
  }
  const limitText = params.get("limit")
  const cursor = params.get("cursor")
  if (limitText !== null && !/^\d{1,6}$/.test(limitText)) throw new ValidationFailure({ issues: ["limit must be an integer"] })
  if (limitText === null && cursor === null) return undefined
  return { ...(limitText === null ? {} : { limit: Number(limitText) }), ...(cursor === null ? {} : { cursor }) }
}
export const emptyInput = (value: unknown): Record<string, never> => {
  object(value)
  return {}
}
