import type { EFacturaLine, EFacturaTaxSubtotal, EFacturaVatCategory } from "./contracts/document.ts"
import { amountOrSkip, characterCount, normalizeSpace, scaled } from "./decimals.ts"

/**
 * EN 16931 / CIUS-RO VAT rules that hold for a single line or a single
 * breakdown, independent of the rest of the document.
 *
 * Each rule cites its identifier from the Schematron package inspected in
 * docs/VAT_TREATMENT.md and ANAF's technical recommendation quoted in
 * docs/EFACTURA.md. Checking them here turns a remote rejection into a local,
 * named refusal; it does not replace the official validation.
 */

/** BT-121 for a supply by a person not registered for VAT. */
export const VATEX_NOT_SUBJECT = "VATEX-EU-O"

/**
 * Reads the percentage, enforcing presence exactly where the category needs it.
 *
 * `O` means "not subject to VAT", so a rate of any value — zero included —
 * asserts something the category denies. The two places differ in what backs
 * the refusal: BR-O-05 forbids BT-152 on a line outright, while BR-48 merely
 * stops requiring BT-119 on a breakdown that is not subject to VAT — its test
 * is satisfied by the category alone and stays true even if the rate is there.
 * No EN 16931 or CIUS-RO rule forbids BT-119 on such a breakdown, so refusing
 * it is this product's rule following ANAF's recommended shape, and `rule` says
 * so rather than naming a rule that was never broken.
 */
const percentage = (value: string | null, category: EFacturaVatCategory, where: string, rule: string,
  issues: Array<string>): bigint | null => {
  if (category === "O") {
    if (value !== null) issues.push(`${where} is category O and must carry no VAT rate at all, got "${value}" (${rule})`)
    return null
  }
  if (value === null) {
    issues.push(`${where} is category ${category} and needs a VAT rate`)
    return null
  }
  return scaled(value, 2, `${where}.rate`, issues)
}

/** BR-CO-17 — the category tax amount is the taxable amount times the rate,
 * rounded half up to two decimals. Integer arithmetic throughout: the whole
 * point of the rule is the last cent. */
const expectedTax = (base: bigint, percent: bigint): bigint => (2n * base * percent + 10_000n) / 20_000n

/** BR-CO-17 for `S`, and BR-E-09 / BR-O-09 for the categories that must not
 * carry any VAT at all. */
const checkSubtotalArithmetic = (subtotal: EFacturaTaxSubtotal, percent: bigint | null,
  where: string, issues: Array<string>): void => {
  const base = amountOrSkip(subtotal.taxableAmount)
  const tax = amountOrSkip(subtotal.taxAmount)
  if (base === null || tax === null) return
  if (subtotal.category !== "S") {
    if (tax !== 0n) {
      issues.push(`${where} is category ${subtotal.category} and its VAT amount must be zero `
        + `(BR-${subtotal.category}-09)`)
    }
    return
  }
  if (percent !== null && tax !== expectedTax(base, percent)) {
    issues.push(`${where}.taxAmount is not the taxable amount times the rate, rounded half up (BR-CO-17)`)
  }
}

/** BR-S-05/10, BR-E-05/10, BR-O-05/10, BR-CO-17 and BR-RO-L100 on one breakdown. */
export const checkVatSubtotal = (subtotal: EFacturaTaxSubtotal, index: number, issues: Array<string>): void => {
  const where = `taxSubtotals[${String(index)}]`
  const percent = percentage(subtotal.percent, subtotal.category, where,
    "product rule, not BR-48: a breakdown that is not subject to VAT states no rate", issues)
  checkSubtotalArithmetic(subtotal, percent, where, issues)
  const reason = subtotal.exemptionReason === null ? "" : normalizeSpace(subtotal.exemptionReason)
  if (characterCount(reason) > 100) {
    issues.push(`${where}.exemptionReason exceeds 100 characters after normalize-space (BR-RO-L100)`)
  }
  // A value made of whitespace is dropped by the renderer, so a rule satisfied
  // by one would be satisfied by an element ANAF never receives. Blank counts
  // as absent below, and is refused here so the caller learns which it is.
  for (const [field, value] of [["exemptionReason", subtotal.exemptionReason],
    ["exemptionReasonCode", subtotal.exemptionReasonCode]] as const) {
    if (value !== null && value.trim().length === 0) {
      issues.push(`${where}.${field} is stated but empty; omit it instead of sending nothing`)
    }
  }
  const code = subtotal.exemptionReasonCode !== null && subtotal.exemptionReasonCode.trim().length > 0
    ? subtotal.exemptionReasonCode : null

  if (subtotal.category === "S") {
    if (percent === 0n) issues.push(`${where} is category S but its rate is zero (BR-S-05)`)
    if (subtotal.exemptionReason !== null) {
      issues.push(`${where} is category S but carries an exemption reason (BR-S-10)`)
    }
    if (subtotal.exemptionReasonCode !== null) {
      issues.push(`${where} is category S but carries an exemption reason code (BR-S-10)`)
    }
    return
  }

  if (subtotal.category === "E") {
    if (percent !== null && percent !== 0n) {
      issues.push(`${where} is category E but its rate is not zero (BR-E-05)`)
    }
    if (reason.length === 0 && code === null) {
      issues.push(`${where} is category E and needs an exemption reason code or text (BR-E-10)`)
    }
    return
  }

  // BR-O-10 asks only that a breakdown not subject to VAT carry a reason —
  // `exists(TaxExemptionReason) or exists(TaxExemptionReasonCode)` — so free
  // text alone satisfies it and this refusal is not that rule. It is the
  // product's: there is exactly one ground on which we issue category O, ANAF's
  // recommendation names it by code, and a sentence a human wrote instead would
  // leave that ground to be guessed from prose. The case folds the way BR-CL-22
  // folds it, so one code written two ways stays one code here too instead of
  // being refused a second time for an unrelated reason.
  if (code === null || normalizeSpace(code).toUpperCase() !== VATEX_NOT_SUBJECT) {
    issues.push(`${where} is category O and needs exemption reason code ${VATEX_NOT_SUBJECT} `
      + `(product rule, not BR-O-10: the ground is named by its code, not in prose)`)
  }
}

/** Line-level structure and VAT category agreement. Returns the line net
 * amount so the caller can total it without parsing twice. */
export const checkLine = (line: EFacturaLine, index: number, issues: Array<string>): bigint | null => {
  const where = `lines[${String(index)}]`
  if (line.id.trim().length === 0) issues.push(`${where}.id is required (BT-126)`)
  if (line.name.trim().length === 0) issues.push(`${where}.name is required (BT-153)`)
  // BR-CL-23 has two halves. Membership in UN/ECE Recommendation 20 is not
  // copied here — 2162 codes do not fit the cube, and docs/EFACTURA.md records
  // that as the host's guarantee. The other half costs one comparison: the rule
  // reads the code through `normalize-space` and refuses whatever still holds a
  // space, which is the shape two codes take when they arrive in one field.
  // A blank code normalises to nothing, so it fails only the check above.
  const unit = normalizeSpace(line.unitCode)
  if (unit.length === 0) issues.push(`${where}.unitCode is required (BT-130)`)
  if (unit.includes(" ")) {
    issues.push(`${where}.unitCode must be a single UN/ECE Recommendation 20 code, `
      + `got "${line.unitCode}" (BR-CL-23)`)
  }
  const quantity = scaled(line.quantity, 4, `${where}.quantity`, issues)
  if (quantity === 0n) issues.push(`${where}.quantity must be greater than zero`)
  scaled(line.unitPrice, 2, `${where}.unitPrice`, issues)
  const percent = percentage(line.vatRate, line.vatCategory, where, "BR-O-05", issues)
  if (line.vatCategory === "S" && percent === 0n) {
    issues.push(`${where} is category S but its rate is zero (BR-S-05)`)
  }
  if (line.vatCategory === "E" && percent !== null && percent !== 0n) {
    issues.push(`${where} is category E but its rate is not zero (BR-E-05)`)
  }
  return scaled(line.netAmount, 2, `${where}.netAmount`, issues)
}
