import { array, integer, nullableText, object, optionalText, text, type Decoder } from "./model-decoder.ts"
import type {
  Issuer, VatCatalogue, VatCategoryCode, VatConfiguration, VatRate, VatRegistration,
} from "./catalog-models.ts"
import { decodeIssuerProfileSnapshot } from "./party-decoders.ts"

export const ARTICLE_310_EXEMPTION_REASON = "Regim special de scutire conform art. 310 din Codul fiscal"
export const isTaxableVatCode = (code: string): boolean =>
  ["RO_STANDARD", "RO_REDUCED", "RO_REDUCED_5"].includes(code)

export const decodeVatCategoryCode = (input: unknown): VatCategoryCode => {
  const value = text(input, "vatCategoryCode")
  if (value !== "S" && value !== "O") throw new Error("invalid vatCategoryCode")
  return value
}

// The two treatments the backend can issue, stated as one exhaustive rule
// rather than two independent ones: a per-category `if` accepts anything the
// server later rejects, simply by belonging to no branch.
export const canonicalVatTreatment = (
  code: string,
  rate: string,
  vatCategoryCode: VatCategoryCode,
  vatExemptionReason: string | null,
): void => {
  const numericRate = Number(rate)
  if (!/^(?:0|[1-9]\d?|100)(?:\.\d{1,2})?$/.test(rate) || numericRate > 100) throw new Error("invalid rate")
  const valid = vatCategoryCode === "S"
    ? numericRate > 0 && vatExemptionReason === null && isTaxableVatCode(code)
    : code === "RO_NON_VAT" && numericRate === 0 && vatExemptionReason === ARTICLE_310_EXEMPTION_REASON
  if (!valid) throw new Error("invalid VAT treatment")
}

const decodeVatConfiguration: Decoder<VatConfiguration> = (input) => {
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
    configuration.code,
    configuration.rate,
    configuration.vatCategoryCode,
    configuration.vatExemptionReason,
  )
  return configuration
}

const decodeVatRegistration: Decoder<VatRegistration> = (input) => {
  const value = object(input)
  if (typeof value.registered !== "boolean") throw new Error("invalid registered")
  const effectiveTo = optionalText(value.effectiveTo, "effectiveTo")
  const period = {
    effectiveFrom: text(value.effectiveFrom, "effectiveFrom"),
    ...(effectiveTo === undefined ? {} : { effectiveTo }),
  }
  if (value.registered) {
    if (Object.hasOwn(value, "nonVatBasis")) throw new Error("invalid nonVatBasis")
    return { registered: true, ...period }
  }
  if (value.nonVatBasis !== "article_310") throw new Error("invalid nonVatBasis")
  return { registered: false, nonVatBasis: "article_310", ...period }
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

export const decodeIssuer: Decoder<Issuer> = (input) => {
  const value = object(input)
  const vatConfigurations = array(value.vatConfigurations, decodeVatConfiguration, "vatConfigurations")
  const currentVat = value.currentVat === null ? null : decodeVatRegistration(value.currentVat)
  if (currentVat !== null) {
    const active = vatConfigurations.filter(({ effectiveFrom, effectiveTo }) =>
      effectiveFrom <= currentVat.effectiveFrom
      && (effectiveTo === undefined || currentVat.effectiveFrom <= effectiveTo))
    const validProjection = active.length > 0 && (currentVat.registered
      ? active.every(({ vatCategoryCode }) => vatCategoryCode === "S")
      : active.every(({ vatCategoryCode }) => vatCategoryCode === "O"))
    if (!validProjection) throw new Error("invalid currentVat projection")
  }
  return {
    ...decodeIssuerProfileSnapshot(value),
    organizationId: text(value.organizationId, "organizationId"),
    defaultCurrency: text(value.defaultCurrency, "defaultCurrency"),
    defaultPaymentTermDays: integer(value.defaultPaymentTermDays, "defaultPaymentTermDays"),
    vatConfigurations,
    currentVat,
  }
}
