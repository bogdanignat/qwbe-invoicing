import { compareDecimal, formatDecimal, parseDecimal } from "../../../contracts/money.ts"
import { spvCif } from "../../connection/index.ts"
import type { ReceivedDocument, ReceivedWarning } from "./document.ts"
import { computable } from "./fields.ts"

/**
 * What is wrong in a received document without making it unreadable: lines
 * that do not add up to `LineExtensionAmount`, `TaxExclusiveAmount` plus the
 * VAT in the document's currency that is not `TaxInclusiveAmount`, and a buyer
 * that is not the organization the invoice was fetched for. Sums are exact, at
 * the precision the XML wrote; nothing goes through `number`.
 */

const fractionDigits = (value: string): number => value.split(".")[1]?.length ?? 0

const sum = (values: ReadonlyArray<string>): string => {
  const exact = values.map(computable)
  const scale = exact.reduce((widest, value) => Math.max(widest, fractionDigits(value)), 0)
  const total = exact.reduce((running, value) => {
    const parsed = parseDecimal(value, scale)
    return parsed.ok ? running + parsed.units : running
  }, 0n)
  return formatDecimal(total, scale)
}

const mismatch = (code: "lines_total_mismatch" | "tax_inclusive_mismatch", declared: string, computed: string): ReadonlyArray<ReceivedWarning> =>
  compareDecimal(computable(declared), computed) === 0 ? [] : [{ code, declared, computed }]

/** The CIF as the SPV knows it: no `RO`, no spaces. */
const normalizedCif = (identifier: string): string | undefined => spvCif(identifier.replace(/\s+/gu, ""))

const buyerMismatch = (document: ReceivedDocument, expectedCif: string): ReadonlyArray<ReceivedWarning> => {
  const expected = normalizedCif(expectedCif) ?? expectedCif
  const { vatId, taxRegistrationId, registrationId } = document.buyer
  const found = [vatId, taxRegistrationId, registrationId].filter((identifier) => identifier !== undefined)
  return found.some((identifier) => normalizedCif(identifier) === expected) ? [] : [{ code: "buyer_cif_mismatch", expected, found }]
}

export const receivedWarnings = (document: ReceivedDocument, expectedBuyerCif: string): ReadonlyArray<ReceivedWarning> => {
  const { totals, vat } = document
  return [
    ...mismatch("lines_total_mismatch", totals.lineExtension.value, sum(document.lines.map((line) => line.netAmount.value))),
    ...mismatch("tax_inclusive_mismatch", totals.taxInclusive.value, sum([totals.taxExclusive.value, vat.total?.value ?? "0"])),
    ...buyerMismatch(document, expectedBuyerCif),
  ]
}
