import type { MonetaryTotals, Vat, VatBreakdown } from "./document.ts"
import { defined, optionalAmount, optionalDecimal, optionalText, requiredAmount, requiredText } from "./fields.ts"
import { all, refuseField, required, type UblNode } from "./xml-tree.ts"

/**
 * The document's totals and VAT. A document may carry two `cac:TaxTotal`: one
 * in its own currency, with the breakdown by rate, and one in `TaxCurrencyCode`
 * (RON on an invoice in EUR). They are told apart by the `currencyID` of their
 * `TaxAmount`, never added together; a total in a third currency is refused.
 */
export const readTotals = (root: UblNode): MonetaryTotals => {
  const totals = required(root, "cac:LegalMonetaryTotal")
  return defined({
    lineExtension: requiredAmount(totals, "cbc:LineExtensionAmount"),
    taxExclusive: requiredAmount(totals, "cbc:TaxExclusiveAmount"),
    taxInclusive: requiredAmount(totals, "cbc:TaxInclusiveAmount"),
    allowanceTotal: optionalAmount(totals, "cbc:AllowanceTotalAmount"),
    chargeTotal: optionalAmount(totals, "cbc:ChargeTotalAmount"),
    prepaid: optionalAmount(totals, "cbc:PrepaidAmount"),
    rounding: optionalAmount(totals, "cbc:PayableRoundingAmount"),
    payable: requiredAmount(totals, "cbc:PayableAmount"),
  })
}

const readSubtotal = (subtotal: UblNode): VatBreakdown => defined({
  category: requiredText(subtotal, "cac:TaxCategory/cbc:ID"),
  percent: optionalDecimal(subtotal, "cac:TaxCategory/cbc:Percent"),
  taxable: requiredAmount(subtotal, "cbc:TaxableAmount"),
  tax: requiredAmount(subtotal, "cbc:TaxAmount"),
  exemptionCode: optionalText(subtotal, "cac:TaxCategory/cbc:TaxExemptionReasonCode"),
  exemptionReason: optionalText(subtotal, "cac:TaxCategory/cbc:TaxExemptionReason"),
})

export const readVat = (root: UblNode, currency: string, taxCurrency: string | undefined): Vat => {
  const totals = all(root, "cac:TaxTotal").map((node) => ({ node, amount: requiredAmount(node, "cbc:TaxAmount") }))
  const inCurrency = (code: string | undefined) => totals.filter(({ amount }) => amount.currency === code)
  const own = inCurrency(currency)
  const other = taxCurrency === currency ? [] : inCurrency(taxCurrency)
  if (own.length > 1 || other.length > 1) refuseField("duplicate", "cac:TaxTotal")
  if (own.length + other.length !== totals.length) refuseField("invalid", "cac:TaxTotal/cbc:TaxAmount@currencyID")
  return defined({
    total: own[0]?.amount,
    taxCurrencyTotal: other[0]?.amount,
    breakdown: own[0] === undefined ? [] : all(own[0].node, "cac:TaxSubtotal").map(readSubtotal),
  })
}
