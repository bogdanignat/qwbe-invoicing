import type { AllowanceCharge } from "./document.ts"
import { defined, optionalAmount, optionalDecimal, optionalText, requiredAmount, requiredText } from "./fields.ts"
import { refuseField, type UblNode } from "./xml-tree.ts"

/**
 * A `cac:AllowanceCharge`, on the document or on a line: allowance or charge,
 * its amount, base and percentage, its reason, and (on the document) the VAT
 * category it falls under. `ChargeIndicator` is `xs:boolean`.
 */
const INDICATOR: Readonly<Record<string, boolean>> = { true: true, "1": true, false: false, "0": false }

export const readAllowanceCharge = (node: UblNode): AllowanceCharge => {
  const charge = INDICATOR[requiredText(node, "cbc:ChargeIndicator")] ?? refuseField("invalid", "cbc:ChargeIndicator")
  return defined({
    charge,
    amount: requiredAmount(node, "cbc:Amount"),
    baseAmount: optionalAmount(node, "cbc:BaseAmount"),
    percent: optionalDecimal(node, "cbc:MultiplierFactorNumeric"),
    reason: optionalText(node, "cbc:AllowanceChargeReason"),
    reasonCode: optionalText(node, "cbc:AllowanceChargeReasonCode"),
    vatCategory: optionalText(node, "cac:TaxCategory/cbc:ID"),
    vatPercent: optionalDecimal(node, "cac:TaxCategory/cbc:Percent"),
  })
}
