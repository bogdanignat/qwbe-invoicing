import type { EFacturaDocument } from "./contracts/document.ts"
import { money } from "./decimals.ts"

/**
 * The monetary identities of EN 16931.
 *
 * Every one of them is an equality the document asserts about itself, so a
 * mismatch is never a rounding opinion: it means the snapshot disagrees with
 * its own totals and must not be sent.
 */

/** BR-CO-10 and BR-CO-13..16. Allowances, charges and prepaid amounts are out
 * of scope today, so the identities collapse to strict equalities: any
 * difference means the snapshot disagrees with itself, not that a discount
 * needs modelling. */
export const checkTotals = (document: EFacturaDocument, lineSum: bigint | null, issues: Array<string>): void => {
  const lineExtension = money(document.lineExtensionAmount, "lineExtensionAmount", issues)
  const exclusive = money(document.taxExclusiveAmount, "taxExclusiveAmount", issues)
  const taxAmount = money(document.taxAmount, "taxAmount", issues)
  const inclusive = money(document.taxInclusiveAmount, "taxInclusiveAmount", issues)
  const payable = money(document.payableAmount, "payableAmount", issues)

  let taxableSum: bigint | null = 0n
  let subtotalTaxSum: bigint | null = 0n
  for (const [index, subtotal] of document.taxSubtotals.entries()) {
    const taxable = money(subtotal.taxableAmount, `taxSubtotals[${String(index)}].taxableAmount`, issues)
    const tax = money(subtotal.taxAmount, `taxSubtotals[${String(index)}].taxAmount`, issues)
    taxableSum = taxable === null || taxableSum === null ? null : taxableSum + taxable
    subtotalTaxSum = tax === null || subtotalTaxSum === null ? null : subtotalTaxSum + tax
  }

  if (lineSum !== null && lineExtension !== null && lineSum !== lineExtension) {
    issues.push("lineExtensionAmount does not equal the sum of line net amounts (BR-CO-10)")
  }
  if (exclusive !== null && lineExtension !== null && exclusive !== lineExtension) {
    issues.push("taxExclusiveAmount does not equal lineExtensionAmount; "
      + "document allowances and charges are not supported (BR-CO-13)")
  }
  if (exclusive !== null && taxableSum !== null && taxableSum !== exclusive) {
    issues.push("the VAT breakdown taxable amounts do not sum to taxExclusiveAmount (BR-CO-14)")
  }
  if (taxAmount !== null && subtotalTaxSum !== null && subtotalTaxSum !== taxAmount) {
    issues.push("the VAT breakdown tax amounts do not sum to taxAmount (BR-CO-14)")
  }
  if (inclusive !== null && exclusive !== null && taxAmount !== null && inclusive !== exclusive + taxAmount) {
    issues.push("taxInclusiveAmount does not equal taxExclusiveAmount plus taxAmount (BR-CO-15)")
  }
  if (payable !== null && inclusive !== null && payable !== inclusive) {
    issues.push("payableAmount does not equal taxInclusiveAmount; prepaid amounts are not supported (BR-CO-16)")
  }
}
