import { ValidationFailure } from "../../contracts/failures.ts"
import { normalizeMoney } from "../../domain/calculation.ts"
import { normalizeUnitOfMeasure, type UnitOfMeasure } from "../../domain/unit-of-measures.ts"

// A saved product or service. A document line copies its values when it is chosen,
// so editing or deleting the preset never changes a draft or an issued document.
export interface ProductPreset {
  readonly id: string
  readonly organizationId: string
  readonly description: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
}

export type ProductPresetInput = Pick<ProductPreset, "description" | "unitPrice" | "unitOfMeasure">
export type UpdateProductPresetInput = ProductPresetInput & { readonly id: string }

export const normalizeProductPreset = (input: ProductPresetInput): ProductPresetInput => {
  const description = input.description.trim()
  if (description.length === 0) throw new ValidationFailure({ issues: ["description is required"] })
  return { description, unitPrice: normalizeMoney(input.unitPrice, "unitPrice"), unitOfMeasure: normalizeUnitOfMeasure(input.unitOfMeasure) }
}
