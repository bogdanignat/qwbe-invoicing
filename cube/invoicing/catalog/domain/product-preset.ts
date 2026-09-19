import { ValidationFailure } from "../../contracts/failures.ts"
import { normalizeMoney } from "../../domain/calculation.ts"
import { normalizeUnitOfMeasure, type UnitOfMeasure } from "../../domain/unit-of-measures.ts"
import { isTaxableVatRateOn } from "../../registry/index.ts"

// A saved product or service. A document line copies its values when it is chosen,
// so editing or deleting the preset never changes a draft or an issued document.
export interface ProductPreset {
  readonly id: string
  readonly organizationId: string
  readonly description: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  // The code of the taxable rate the product prefers, never a percentage: the rate is
  // resolved on the document date, so a legal rate change needs no product edit. Absent
  // means the issuer's default. The line still carries its own code, which the server checks.
  readonly preferredVatRateCode?: string
}

export type ProductPresetInput = Pick<ProductPreset, "description" | "unitPrice" | "unitOfMeasure" | "preferredVatRateCode">
export type UpdateProductPresetInput = ProductPresetInput & { readonly id: string }

// `today` is the organization's calendar date. The preference is checked on every save, so a
// code the law has retired since must be replaced or removed before the product can change.
export const normalizeProductPreset = (input: ProductPresetInput, today: string): ProductPresetInput => {
  const description = input.description.trim()
  if (description.length === 0) throw new ValidationFailure({ issues: ["description is required"] })
  const preferred = input.preferredVatRateCode
  if (preferred !== undefined && !isTaxableVatRateOn(preferred, today)) {
    throw new ValidationFailure({ issues: [`preferredVatRateCode must be a taxable VAT rate in force on ${today}`] })
  }
  return {
    description, unitPrice: normalizeMoney(input.unitPrice, "unitPrice"), unitOfMeasure: normalizeUnitOfMeasure(input.unitOfMeasure),
    ...(preferred === undefined ? {} : { preferredVatRateCode: preferred }),
  }
}
