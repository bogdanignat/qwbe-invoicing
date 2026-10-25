import { DomainConflict, ValidationFailure } from "../../contracts/failures.ts"
import { normalizeMoney } from "../../domain/calculation.ts"
import { normalizeUnitOfMeasure, type UnitOfMeasure } from "../../domain/unit-of-measures.ts"
import { validateLineDescription } from "../../domain/validation.ts"
import { normalizeItemCode, validateBarcode } from "../../items/index.ts"
import { isTaxableVatRateOn } from "../../issuer/index.ts"

export const productKinds = ["goods", "service"] as const
export type ProductKind = (typeof productKinds)[number]

// A product of the organization's nomenclature. A document line copies its values (the code
// and the barcode included) when it is chosen, and never links back: editing or deleting the
// product never changes a draft or an issued document.
export interface ProductPreset {
  readonly id: string
  readonly organizationId: string
  // The article code: printable ASCII only, unique in the organization whatever its case. The unique
  // index on (organization_id, lower(code)) decides it, so two concurrent saves cannot both win; the
  // store maps the clash to a conflict.
  readonly code: string
  readonly kind: ProductKind
  readonly description: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  // The code of the taxable rate the product prefers, never a percentage: the rate is
  // resolved on the document date, so a legal rate change needs no product edit. Absent
  // means the issuer's default. The line still carries its own code, which the server checks.
  readonly preferredVatRateCode?: string
  // A GTIN (EAN) as text, leading zeros kept. Optional and not unique: two packagings may share one.
  readonly barcode?: string
}

export type ProductPresetInput = Pick<ProductPreset, "code" | "kind" | "description" | "unitPrice" | "unitOfMeasure"
  | "preferredVatRateCode" | "barcode">
export type UpdateProductPresetInput = ProductPresetInput & { readonly id: string }

// The one catalog conflict a person can act on, so its message is written for them and sent as is.
export const productPresetCodeTaken = "product_preset_code_taken"
export const codeTakenConflict = (code: string): DomainConflict =>
  new DomainConflict({ code: productPresetCodeTaken, message: `Codul ${code} e deja folosit.` })

// `today` is the organization's calendar date. The preference is checked on every save, so a
// code the law has retired since must be replaced or removed before the product can change.
export const normalizeProductPreset = (input: ProductPresetInput, today: string): ProductPresetInput => {
  const description = input.description.trim()
  if (description.length === 0) throw new ValidationFailure({ issues: ["description is required"] })
  validateLineDescription(description)
  const kind: unknown = input.kind
  if (!productKinds.includes(kind as ProductKind)) throw new ValidationFailure({ issues: ["kind must be goods or service"] })
  const preferred = input.preferredVatRateCode
  if (preferred !== undefined && !isTaxableVatRateOn(preferred, today)) {
    throw new ValidationFailure({ issues: [`preferredVatRateCode must be a taxable VAT rate in force on ${today}`] })
  }
  const barcode = input.barcode
  if (barcode !== undefined) validateBarcode(barcode)
  return {
    code: normalizeItemCode(input.code, "code"), kind: input.kind,
    description, unitPrice: normalizeMoney(input.unitPrice, "unitPrice"), unitOfMeasure: normalizeUnitOfMeasure(input.unitOfMeasure),
    ...(preferred === undefined ? {} : { preferredVatRateCode: preferred }),
    ...(barcode === undefined ? {} : { barcode }),
  }
}
