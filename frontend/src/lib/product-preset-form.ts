import { presetVatIssue } from "./product-preset-vat.ts"
import { barcodeIssue, itemCodeIssue } from "./item-identifiers.ts"
import type { ProductKind, ProductPreset, UnitOfMeasure, VatRate } from "./draft-models.ts"
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
  readonly code: string
  readonly kind: ProductKind
  readonly description: string
  readonly unitOfMeasureCode: string
  readonly unitPrice: string
  /** The empty string is the issuer's default, never a code. */
  readonly preferredVatRateCode: string
  /** Text, so its leading zeros stay; the empty string is no EAN. */
  readonly barcode: string
}

export const productKindLabels: Readonly<Record<ProductKind, string>> = { goods: "Bun", service: "Serviciu" }

/** The UN/ECE code for "piece"; the legacy editor opened on it too. */
export const DEFAULT_UNIT_CODE = "C62"

export const PRODUCT_PRICE_PATTERN = "\\d+(?:[.,]\\d{1,2})?"

export const newProductPresetForm = (units: ReadonlyArray<UnitOfMeasure>): ProductPresetForm => ({
  code: "",
  kind: "goods",
  description: "",
  unitOfMeasureCode: units.some(({ code }) => code === DEFAULT_UNIT_CODE)
    ? DEFAULT_UNIT_CODE
    : units[0]?.code ?? "",
  unitPrice: "",
  preferredVatRateCode: "",
  barcode: "",
})

export const productPresetFormOf = (preset: ProductPreset): ProductPresetForm => ({
  code: preset.code,
  kind: preset.kind,
  description: preset.description,
  unitOfMeasureCode: preset.unitOfMeasure.code,
  unitPrice: preset.unitPrice,
  preferredVatRateCode: preset.preferredVatRateCode ?? "",
  barcode: preset.barcode ?? "",
})

export type ProductPresetField = "code" | "description" | "unitOfMeasure" | "unitPrice" | "preferredVatRateCode" | "barcode"

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
  const code = form.code.trim()
  if (code === "") return issue("code", "Codul articolului este obligatoriu.")
  const codeIssue = itemCodeIssue(code)
  if (codeIssue !== null) return issue("code", codeIssue)
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
  const eanIssue = barcodeIssue(form.barcode)
  if (eanIssue !== null) return issue("barcode", eanIssue)
  const barcode = form.barcode.trim()
  return {
    kind: "ready",
    payload: {
      code,
      kind: form.kind,
      description,
      unitPrice,
      unitOfMeasure,
      ...(form.preferredVatRateCode === "" ? {} : { preferredVatRateCode: form.preferredVatRateCode }),
      ...(barcode === "" ? {} : { barcode }),
    },
  }
}
