import { array, integer, nullableText, object, optionalText, text, type Decoder } from "./model-decoder.ts"
import { decodeAddress, decodeUnitOfMeasure } from "./document-snapshot-decoders.ts"
import type {
  DocumentSeries, Issuer, ProductPreset, VatCatalogue, VatConfiguration, VatRate, VatRegistration,
} from "./draft-models.ts"
import { canonicalVatTreatment, decodeVatCategoryCode } from "./draft-decoders.ts"

/** Decoders for the reference data an authoring session reads: registries, catalogues and the issuer profile. */

/**
 * The two registry records are decoded in `registry-decoders.ts`: the writes
 * need them too. They are re-exported here so the reference client keeps its
 * single import.
 */
export { decodeCustomerPage, decodeProductPresetPage } from "./registry-decoders.ts"

export const decodeDocumentSeries: Decoder<DocumentSeries> = (input) => {
  const value = object(input)
  const documentType = text(value.documentType, "documentType")
  if (documentType !== "invoice" && documentType !== "proforma") throw new Error("invalid documentType")
  return { organizationId: text(value.organizationId, "organizationId"), documentType, series: text(value.series, "series") }
}

export const decodeDocumentSeriesList: Decoder<ReadonlyArray<DocumentSeries>> = (input) =>
  array(input, decodeDocumentSeries, "documentSeries")

export const decodeUnitOfMeasures: Decoder<ReadonlyArray<ProductPreset["unitOfMeasure"]>> = (input) =>
  array(input, decodeUnitOfMeasure, "unitOfMeasures")

export const decodeIssuer: Decoder<Issuer> = (input) => {
  const value = object(input)
  const legalForm = text(value.legalForm, "legalForm")
  if (legalForm !== "srl" && legalForm !== "pfa") throw new Error("invalid legalForm")
  const vatConfigurations: ReadonlyArray<VatConfiguration> = array(value.vatConfigurations, decodeVatConfiguration, "vatConfigurations")
  const currentVat: VatRegistration | null = value.currentVat === null ? null : decodeVatRegistration(value.currentVat)
  return {
    organizationId: text(value.organizationId, "organizationId"),
    name: text(value.name, "name"),
    fiscalIdentifier: text(value.fiscalIdentifier, "fiscalIdentifier"),
    address: decodeAddress(value.address),
    legalForm,
    tradeRegistryNumber: text(value.tradeRegistryNumber, "tradeRegistryNumber"),
    iban: text(value.iban, "iban"),
    bankName: text(value.bankName, "bankName"),
    socialCapital: text(value.socialCapital, "socialCapital"),
    defaultCurrency: text(value.defaultCurrency, "defaultCurrency"),
    defaultPaymentTermDays: integer(value.defaultPaymentTermDays, "defaultPaymentTermDays"),
    vatConfigurations,
    currentVat,
  }
}

export const decodeVatConfiguration: Decoder<VatConfiguration> = (input) => {
  const value = object(input)
  const effectiveTo = optionalText(value.effectiveTo, "effectiveTo")
  const configuration = {
    code: text(value.code, "code"),
    rate: text(value.rate, "rate"),
    vatCategoryCode: decodeVatCategoryCode(value.vatCategoryCode),
    vatExemptionReason: nullableText(value.vatExemptionReason, "vatExemptionReason"),
    effectiveFrom: text(value.effectiveFrom, "effectiveFrom"),
    ...(effectiveTo === undefined ? {} : { effectiveTo }),
  }
  canonicalVatTreatment(
    configuration.code, configuration.rate,
    configuration.vatCategoryCode, configuration.vatExemptionReason,
  )
  return configuration
}

export const decodeVatRegistration: Decoder<VatRegistration> = (input) => {
  const value = object(input)
  if (typeof value.registered !== "boolean") throw new Error("invalid registered")
  const effectiveTo = optionalText(value.effectiveTo, "effectiveTo")
  const period = { effectiveFrom: text(value.effectiveFrom, "effectiveFrom") }
  if (value.registered) {
    if (Object.hasOwn(value, "nonVatBasis")) throw new Error("invalid nonVatBasis")
    return { registered: true, ...period, ...(effectiveTo === undefined ? {} : { effectiveTo }) }
  }
  if (value.nonVatBasis !== "article_310") throw new Error("invalid nonVatBasis")
  return { registered: false, nonVatBasis: "article_310", ...period, ...(effectiveTo === undefined ? {} : { effectiveTo }) }
}

const decodeVatRate: Decoder<VatRate> = (input) => {
  const value = object(input)
  const kind = text(value.kind, "kind")
  if (kind !== "standard" && kind !== "reduced" && kind !== "non_vat") throw new Error("invalid VAT kind")
  const configuration = decodeVatConfiguration(value)
  if ((kind === "non_vat") !== (configuration.vatCategoryCode === "O")) {
    throw new Error("invalid VAT kind treatment")
  }
  if ((kind === "standard") !== (configuration.code === "RO_STANDARD")
    || (kind === "reduced") !== ["RO_REDUCED", "RO_REDUCED_5"].includes(configuration.code)) {
    throw new Error("invalid VAT kind code")
  }
  return { ...configuration, kind, label: text(value.label, "label") }
}

export const decodeVatCatalogue: Decoder<VatCatalogue> = (input) => {
  const value = object(input)
  return { rates: array(value.rates, decodeVatRate, "rates") }
}
