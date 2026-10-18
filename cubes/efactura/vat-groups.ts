import type { EFacturaDocument, EFacturaVatCategory } from "./contracts/document.ts"
import { amountOrSkip } from "./decimals.ts"

/**
 * The VAT rules that only exist across a whole document.
 *
 * A line and a breakdown can each be perfectly formed and still disagree with
 * one another: a rate present in one and absent from the other, an exempt group
 * stated twice, a taxable amount that does not match the lines it claims to
 * total. Those are the rules collected here.
 */

/**
 * A VAT group is a category and a rate, and the rate is compared as a number.
 *
 * `21` and `21.00` are the same group: keying on the raw string would split
 * them and refuse a document over a difference that does not exist. A rate that
 * does not parse keeps its raw text, because the rule that owns it reports it
 * already and this must not turn one fault into two.
 */
const groupKey = (category: EFacturaVatCategory, rate: string | null): string => {
  if (rate === null) return `${category}:none`
  const parsed = amountOrSkip(rate)
  return `${category}:${parsed === null ? rate : String(parsed)}`
}

/** The same group as a human reads it, for messages: the key is normalized for
 * comparison, so printing it would name a rate nobody wrote. */
const groupLabel = (category: EFacturaVatCategory, rate: string | null): string =>
  `${category} at rate ${rate ?? "none"}`

/** BR-E-01, BR-O-01/02/11..14, BR-S-01 and BR-*-08: at most one exempt or
 * out-of-scope group, `O` never mixed with a taxed category nor stated beside a
 * VAT registration, and every line's group present in the breakdown and totalled
 * by it. */
export const checkVatGroups = (document: EFacturaDocument, issues: Array<string>): void => {
  const categories = new Set(document.taxSubtotals.map((subtotal) => subtotal.category))
  for (const exclusive of ["E", "O"] as const) {
    const count = document.taxSubtotals.filter((subtotal) => subtotal.category === exclusive).length
    if (count > 1) {
      issues.push(`a document may carry at most one ${exclusive} VAT breakdown (BR-${exclusive}-01)`)
    }
  }
  if (categories.has("O") && categories.size > 1) {
    issues.push("a document that is not subject to VAT cannot also carry taxed or exempt lines (BR-O-11..14)")
  }

  // BR-O-02, confirmed by the official validator: a document that is not
  // subject to VAT states no VAT registration at all — not the seller's, not
  // the buyer's. The parties keep their identity through BT-32 and BT-47, which
  // the rule does not touch.
  if (categories.has("O") || document.lines.some((line) => line.vatCategory === "O")) {
    if (document.seller.vatIdentifier !== null) {
      issues.push("a document that is not subject to VAT cannot carry the seller's VAT identifier (BR-O-02)")
    }
    if (document.buyer.vatIdentifier !== null) {
      issues.push("a document that is not subject to VAT cannot carry the buyer's VAT identifier (BR-O-02)")
    }
  }

  const lineSums = new Map<string, bigint | null>()
  for (const [index, line] of document.lines.entries()) {
    const key = groupKey(line.vatCategory, line.vatRate)
    const net = amountOrSkip(line.netAmount)
    const running = lineSums.get(key)
    lineSums.set(key, running === undefined ? net : running === null || net === null ? null : running + net)
    // BR-S-01 / BR-E-01 / BR-O-01 oblige the document to carry a breakdown for
    // the category a line belongs to, and say nothing about its rate. So the
    // two faults are reported apart: a missing category cites them, while a
    // category present at other rates only is refused without a rule number.
    // That second document is still wrong — no group totals the line, which
    // BR-*-08 needs — but citing a rule it satisfies would name a false ground.
    if (!document.taxSubtotals.some((subtotal) => groupKey(subtotal.category, subtotal.percent) === key)) {
      issues.push(categories.has(line.vatCategory)
        ? `lines[${String(index)}] belongs to VAT group ${groupLabel(line.vatCategory, line.vatRate)}, which the `
          + `VAT breakdown does not contain, though it covers category ${line.vatCategory} at another rate`
        : `lines[${String(index)}] is category ${line.vatCategory}, which the VAT breakdown does not contain `
          + `(BR-${line.vatCategory}-01)`)
    }
  }

  const covered = new Set<string>()
  for (const [index, subtotal] of document.taxSubtotals.entries()) {
    const key = groupKey(subtotal.category, subtotal.percent)
    // No numbered rule forbids the repetition outright; it is refused because a
    // group stated twice makes BR-*-08 ambiguous about which half to check.
    if (covered.has(key)) {
      issues.push(`the VAT breakdown states VAT group ${groupLabel(subtotal.category, subtotal.percent)} twice`)
    }
    covered.add(key)
    // BR-S-08 / BR-E-08 / BR-O-08: a breakdown states the total of exactly the
    // lines in its own group, so a line moved between rates cannot go unnoticed.
    const sum = lineSums.get(key)
    const taxable = amountOrSkip(subtotal.taxableAmount)
    if (sum === undefined) {
      issues.push(`taxSubtotals[${String(index)}] describes VAT group `
        + `${groupLabel(subtotal.category, subtotal.percent)}, which no line belongs to`)
    } else if (sum !== null && taxable !== null && sum !== taxable) {
      issues.push(`taxSubtotals[${String(index)}].taxableAmount does not equal the net amounts of its own `
        + `lines (BR-${subtotal.category}-08)`)
    }
  }
}
