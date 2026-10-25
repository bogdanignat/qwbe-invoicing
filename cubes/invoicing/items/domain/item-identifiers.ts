import { ValidationFailure } from "../../contracts/failures.ts"
import type { ItemIdentifiers } from "../../domain/invoice.ts"

/** An article code: once trimmed, 1-50 printable ASCII characters (0x20-0x7E) — letters without
 * diacritics, digits, common signs and inner spaces. Being ASCII only, lower() folds it completely under
 * the C locale, so the unique index on lower(code) makes it truly case-insensitive. The baselines CHECK
 * the same shape. */
export const normalizeItemCode = (value: string, field: string): string => {
  const code = value.trim()
  if (code.length > 50 || !/^[!-~](?:[ -~]*[!-~])?$/.test(code)) {
    throw new ValidationFailure({ issues: [`${field} must be 1-50 printable ASCII characters`] })
  }
  return code
}

/** A GTIN-8, 12, 13 or 14 (EAN), kept as text for its leading zeros. Padded to 14 digits the weights
 * alternate 3, 1 from the left and the sum, check digit included, is a multiple of ten. */
export const validateBarcode = (value: string, field = "barcode"): void => {
  const digits = /^(?:\d{8}|\d{12,14})$/.test(value) ? Array.from(value.padStart(14, "0"), Number) : []
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0)
  if (digits.length === 0 || sum % 10 !== 0) {
    throw new ValidationFailure({ issues: [`${field} must be a GTIN-8, 12, 13 or 14 with a valid check digit`] })
  }
}

/** A line keeps only the identifiers it states; absent stays absent, never an empty string. */
export const itemIdentifiers = ({ itemCode, barcode }: ItemIdentifiers): ItemIdentifiers => {
  if (barcode !== undefined) validateBarcode(barcode)
  return { ...(itemCode === undefined ? {} : { itemCode: normalizeItemCode(itemCode, "itemCode") }), ...(barcode === undefined ? {} : { barcode }) }
}
