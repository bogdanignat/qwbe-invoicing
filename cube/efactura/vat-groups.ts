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

const groupKey = (category: EFacturaVatCategory, rate: string | null): string => `${category}:${rate ?? "-"}`

/** BR-E-01, BR-O-11..14 and BR-CO-18: at most one exempt or out-of-scope
 * group, `O` never mixed with a taxed category, and every line's group present
 * in the breakdown. */
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
    if (!document.taxSubtotals.some((subtotal) => groupKey(subtotal.category, subtotal.percent) === key)) {
      issues.push(`lines[${String(index)}] has no matching VAT breakdown for category `
        + `${line.vatCategory} at rate ${line.vatRate ?? "none"} (BR-CO-18)`)
    }
  }

  const covered = new Set<string>()
  for (const [index, subtotal] of document.taxSubtotals.entries()) {
    const key = groupKey(subtotal.category, subtotal.percent)
    if (covered.has(key)) issues.push(`the VAT breakdown repeats the group ${key} (BR-CO-18)`)
    covered.add(key)
    // BR-S-08 / BR-E-08 / BR-O-08: a breakdown states the total of exactly the
    // lines in its own group, so a line moved between rates cannot go unnoticed.
    const sum = lineSums.get(key)
    const taxable = amountOrSkip(subtotal.taxableAmount)
    if (sum === undefined) {
      issues.push(`taxSubtotals[${String(index)}] describes a VAT group no line belongs to (BR-CO-18)`)
    } else if (sum !== null && taxable !== null && sum !== taxable) {
      issues.push(`taxSubtotals[${String(index)}].taxableAmount does not equal the net amounts of its own `
        + `lines (BR-${subtotal.category}-08)`)
    }
  }
}
