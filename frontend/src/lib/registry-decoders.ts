import { decodeBuyer, decodeUnitOfMeasure } from "./document-snapshot-decoders.ts"
import {
  decodePage, object, optionalInteger, optionalText, text, type Decoder,
} from "./model-decoder.ts"
import type { Customer, ProductPreset } from "./draft-models.ts"

/**
 * The two master-data records, decoded once for both directions.
 *
 * They were private to the reference client's decoders while the frontend only
 * read registries. A write answers with the record it just committed, so the
 * same narrowing now has two callers — the paged reads and `registry-client.ts`
 * — and lives here rather than being duplicated or re-exported through a file
 * that has no room left for it.
 */
export const decodeCustomer: Decoder<Customer> = (input) => {
  const value = object(input)
  const defaultPaymentTermDays = optionalInteger(value.defaultPaymentTermDays, "defaultPaymentTermDays")
  if (defaultPaymentTermDays !== undefined && defaultPaymentTermDays < 0) {
    throw new Error("invalid defaultPaymentTermDays")
  }
  return {
    ...decodeBuyer(input),
    id: text(value.id, "id"),
    organizationId: text(value.organizationId, "organizationId"),
    ...(defaultPaymentTermDays === undefined ? {} : { defaultPaymentTermDays }),
  }
}

export const decodeProductPreset: Decoder<ProductPreset> = (input) => {
  const value = object(input)
  const preferredVatRateCode = optionalText(value.preferredVatRateCode, "preferredVatRateCode")
  return {
    id: text(value.id, "id"),
    organizationId: text(value.organizationId, "organizationId"),
    description: text(value.description, "description"),
    unitPrice: text(value.unitPrice, "unitPrice"),
    unitOfMeasure: decodeUnitOfMeasure(value.unitOfMeasure),
    ...(preferredVatRateCode === undefined ? {} : { preferredVatRateCode }),
  }
}

export const decodeCustomerPage = decodePage(decodeCustomer)
export const decodeProductPresetPage = decodePage(decodeProductPreset)
