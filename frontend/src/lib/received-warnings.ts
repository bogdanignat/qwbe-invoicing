import type { ReceivedWarning, ReceivedWarningCode } from "./received-models.ts"

/**
 * What is wrong in a read received invoice without making it unreadable
 * (`cubes/invoicing/efactura/received-ubl/domain/warnings.ts`): a short label
 * per kind in the list, a sentence with the amounts in the detail.
 */
const WARNING_LABELS: Readonly<Record<ReceivedWarningCode, string>> = {
  lines_total_mismatch: "Totaluri inconsecvente",
  tax_inclusive_mismatch: "Totaluri inconsecvente",
  buyer_cif_mismatch: "Cumpărătorul are alt CIF",
}

/** One label per kind of warning: two totals that do not add up are still one „Totaluri inconsecvente”. */
export const warningLabels = (codes: ReadonlyArray<ReceivedWarningCode>): ReadonlyArray<string> =>
  [...new Set(codes.map((code) => WARNING_LABELS[code]))]

export const receivedWarningText = (warning: ReceivedWarning): string => {
  switch (warning.code) {
    case "lines_total_mismatch":
      return `Totaluri inconsecvente: suma liniilor este ${warning.computed}, iar totalul declarat al liniilor ${warning.declared}.`
    case "tax_inclusive_mismatch":
      return `Totaluri inconsecvente: totalul fără TVA plus TVA dă ${warning.computed}, iar totalul cu TVA declarat este ${warning.declared}.`
    case "buyer_cif_mismatch":
      return `Cumpărătorul de pe factură nu are CIF-ul firmei (${warning.expected}): `
        + (warning.found.length === 0 ? "factura nu dă niciun identificator." : `factura dă ${warning.found.join(", ")}.`)
  }
}
