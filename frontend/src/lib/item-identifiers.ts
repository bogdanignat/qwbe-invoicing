import type { ItemIdentifiers } from "./document-snapshot.ts"

/**
 * The article code and the EAN a line copies from the nomenclature, as text.
 *
 * A line keeps no link to the product, only these two values, so the screens
 * compare and send them by value: trimmed, and absent when blank, as the server
 * stores them. Without it a cleared code would be sent as an empty string, and
 * one typed with spaces around it would never match the saved line.
 */
export const presentIdentifiers = (line: ItemIdentifiers): ItemIdentifiers => {
  const itemCode = line.itemCode?.trim() ?? ""
  const barcode = line.barcode?.trim() ?? ""
  return { ...(itemCode === "" ? {} : { itemCode }), ...(barcode === "" ? {} : { barcode }) }
}

export const sameIdentifiers = (left: ItemIdentifiers, right: ItemIdentifiers): boolean => {
  const [a, b] = [presentIdentifiers(left), presentIdentifiers(right)]
  return a.itemCode === b.itemCode && a.barcode === b.barcode
}

/** What a document shows under the line's name, as the PDF prints it; empty when the line has neither. */
export const identifiersLabel = (line: ItemIdentifiers): string => [
  ...(line.itemCode === undefined ? [] : [`Cod: ${line.itemCode}`]),
  ...(line.barcode === undefined ? [] : [`EAN: ${line.barcode}`]),
].join(" · ")

/**
 * Why a typed article code would be refused, in the words the screen shows at
 * the field; `null` when it is blank (a line without a code) or valid. Once
 * trimmed it is 1-50 printable ASCII characters (0x20-0x7E): letters without
 * diacritics, digits, common signs and inner spaces — the cube's rule, held
 * equal by probes/frontend-cube-parity.test.mjs.
 */
export const itemCodeIssue = (value: string): string | null => {
  const code = value.trim()
  if (code === "") return null
  if (code.length > 50) return "Codul articolului are cel mult 50 de caractere."
  return /^[!-~](?:[ -~]*[!-~])?$/u.test(code)
    ? null
    : "Codul poate conține doar litere fără diacritice, cifre și semne obișnuite."
}

/** A GTIN-8, 12, 13 or 14 whose last digit checks, as the server requires. */
export const isGtin = (value: string): boolean => {
  if (!/^(?:\d{8}|\d{12,14})$/u.test(value)) return false
  const digits = Array.from(value.padStart(14, "0"), Number)
  const sum = digits.reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0)
  return sum % 10 === 0
}

/**
 * Why a typed EAN would be refused, in the words the screen shows at the field;
 * `null` when it is blank (no EAN) or a valid GTIN. The product form and the
 * document line ask the same question, so a wrong EAN never reaches the server.
 */
export const barcodeIssue = (value: string): string | null => {
  const barcode = value.trim()
  return barcode === "" || isGtin(barcode) ? null : "EAN-ul are 8, 12, 13 sau 14 cifre, cu cifra de control corectă."
}
