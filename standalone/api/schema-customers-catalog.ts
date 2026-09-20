import { Schema } from "effect"

import { bodyObject, Buyer, BuyerInput, optional, optionalString, pageOf, UnitOfMeasure } from "./schema-primitives.ts"

export const CustomerInput = Schema.Struct({
  ...BuyerInput.fields, defaultPaymentTermDays: optional(Schema.Int),
}).annotations(bodyObject)
export const Customer = Schema.Struct({
  id: Schema.String, organizationId: Schema.String, ...Buyer.fields,
  defaultPaymentTermDays: optional(Schema.Int), deletedAt: optionalString,
})
export const CustomerPage = pageOf(Customer)
export const ProductPresetInput = Schema.Struct({
  description: Schema.String, unitPrice: Schema.String, unitOfMeasure: UnitOfMeasure,
  preferredVatRateCode: optionalString,
}).annotations(bodyObject)
export const ProductPreset = Schema.Struct({
  id: Schema.String, organizationId: Schema.String, description: Schema.String,
  unitPrice: Schema.String, unitOfMeasure: UnitOfMeasure, preferredVatRateCode: optionalString,
})
export const ProductPresetPage = pageOf(ProductPreset)
