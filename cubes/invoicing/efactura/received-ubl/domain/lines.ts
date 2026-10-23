import { readAllowanceCharge } from "./charges.ts"
import type { ReceivedKind, ReceivedLine } from "./document.ts"
import { codeOf, defined, optionalAmount, optionalDecimal, optionalQuantity, optionalText, requiredAmount, requiredText, texts } from "./fields.ts"
import { all, one, required, type UblNode } from "./xml-tree.ts"

/**
 * The lines of the document: `cac:InvoiceLine` with `InvoicedQuantity`, or
 * `cac:CreditNoteLine` with `CreditedQuantity`. Each keeps its quantity and
 * price at the XML's precision, the price's base quantity, its VAT category,
 * its own allowances and charges, and the item's codes.
 */
const LINE = {
  invoice: { line: "cac:InvoiceLine", quantity: "cbc:InvoicedQuantity" },
  credit_note: { line: "cac:CreditNoteLine", quantity: "cbc:CreditedQuantity" },
} as const

const readLine = (line: UblNode, quantity: string): ReceivedLine => {
  const item = required(line, "cac:Item")
  const descriptions = texts(item, "cbc:Description")
  const standard = one(item, "cac:StandardItemIdentification/cbc:ID")
  return defined({
    id: requiredText(line, "cbc:ID"),
    name: optionalText(item, "cbc:Name"),
    description: descriptions.length === 0 ? undefined : descriptions.join("\n"),
    quantity: optionalQuantity(line, quantity),
    priceBaseQuantity: optionalQuantity(line, "cac:Price/cbc:BaseQuantity"),
    unitPrice: optionalAmount(line, "cac:Price/cbc:PriceAmount"),
    netAmount: requiredAmount(line, "cbc:LineExtensionAmount"),
    vatCategory: optionalText(item, "cac:ClassifiedTaxCategory/cbc:ID"),
    vatPercent: optionalDecimal(item, "cac:ClassifiedTaxCategory/cbc:Percent"),
    allowanceCharges: all(line, "cac:AllowanceCharge").map(readAllowanceCharge),
    sellerItemId: optionalText(item, "cac:SellersItemIdentification/cbc:ID"),
    standardItemId: standard === undefined ? undefined : codeOf(standard, "schemeID"),
    classifications: all(item, "cac:CommodityClassification/cbc:ItemClassificationCode").flatMap((code) => codeOf(code, "listID") ?? []),
  })
}

export const readLines = (root: UblNode, kind: ReceivedKind): ReadonlyArray<ReceivedLine> =>
  all(root, LINE[kind].line).map((line) => readLine(line, LINE[kind].quantity))
