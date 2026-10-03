import { presetVatIssue } from "./product-preset-vat.ts"
import type { ProductPreset, UnitOfMeasure, VatRate } from "./draft-models.ts"
import type { ProductPresetInput } from "./registry-client.ts"

/**
 * The product editor as data: what is typed, and what the typed form becomes.
 *
 * The form is controlled and flat — a unit is held as its code, because that is
 * what a `<select>` carries — and turning it into a payload is a pure step that
 * either yields the body or names the one field that refuses. Keeping the
 * refusal a value (rather than a `reportValidity` call inside the submit
 * handler, as the legacy screen did) is what makes the rules testable without a
 * DOM: the screen focuses the named field, the decision is taken here.
 */
export interface ProductPresetForm {
  readonly description: string
  readonly unitOfMeasureCode: string
  readonly unitPrice: string
  /** The empty string is the issuer's default, never a code. */
  readonly preferredVatRateCode: string
}

/** The UN/ECE code for "piece"; the legacy editor opened on it too. */
export const DEFAULT_UNIT_CODE = "C62"

export const PRODUCT_PRICE_PATTERN = "\\d+(?:[.,]\\d{1,2})?"

export const newProductPresetForm = (units: ReadonlyArray<UnitOfMeasure>): ProductPresetForm => ({
  description: "",
  unitOfMeasureCode: units.some(({ code }) => code === DEFAULT_UNIT_CODE)
    ? DEFAULT_UNIT_CODE
    : units[0]?.code ?? "",
  unitPrice: "",
  preferredVatRateCode: "",
})

export const productPresetFormOf = (preset: ProductPreset): ProductPresetForm => ({
  description: preset.description,
  unitOfMeasureCode: preset.unitOfMeasure.code,
  unitPrice: preset.unitPrice,
  preferredVatRateCode: preset.preferredVatRateCode ?? "",
})

export type ProductPresetField = "description" | "unitOfMeasure" | "unitPrice" | "preferredVatRateCode"

export type ProductPresetValidation =
  | { readonly kind: "ready"; readonly payload: ProductPresetInput }
  | { readonly kind: "issue"; readonly field: ProductPresetField; readonly message: string }

const issue = (field: ProductPresetField, message: string): ProductPresetValidation =>
  ({ kind: "issue", field, message })

export const productPresetPayload = (
  form: ProductPresetForm,
  units: ReadonlyArray<UnitOfMeasure>,
  rates: ReadonlyArray<VatRate>,
): ProductPresetValidation => {
  const description = form.description.trim()
  if (description === "") return issue("description", "Descrierea este obligatorie.")
  const unitOfMeasure = units.find(({ code }) => code === form.unitOfMeasureCode)
  if (unitOfMeasure === undefined) return issue("unitOfMeasure", "Alege o unitate de măsură din catalog.")
  const unitPrice = form.unitPrice.trim().replace(",", ".")
  if (!/^\d+(?:\.\d{1,2})?$/u.test(unitPrice)) {
    return issue("unitPrice", "Prețul unitar este un număr nenegativ cu maximum două zecimale.")
  }
  const vatIssue = presetVatIssue(form.preferredVatRateCode, rates)
  if (vatIssue !== null) return issue("preferredVatRateCode", vatIssue)
  return {
    kind: "ready",
    payload: {
      description,
      unitPrice,
      unitOfMeasure,
      ...(form.preferredVatRateCode === "" ? {} : { preferredVatRateCode: form.preferredVatRateCode }),
    },
  }
}
