import type { EFacturaDocument } from "./contracts/document.ts"
import { EFacturaContractViolation } from "./contracts/failures.ts"
import { checkCiusLimits } from "./cius-limits.ts"
import { amountOrSkip, isCalendarDate } from "./decimals.ts"
import { checkTotals } from "./totals.ts"
import { checkVatGroups } from "./vat-groups.ts"
import { checkLine, checkVatSubtotal } from "./vat-rules.ts"

/**
 * Structural gate in front of the renderer.
 *
 * Passing here does **not** mean the document is valid — only the official
 * validator decides that. Failing here means we would knowingly emit a broken
 * document, so we refuse instead, naming every offending field at once rather
 * than stopping at the first.
 */

const checkIdentity = (document: EFacturaDocument, issues: Array<string>): void => {
  if (document.id.trim().length === 0) issues.push("id is required (BT-1)")
  if (!isCalendarDate(document.issueDate)) issues.push("issueDate must be a valid YYYY-MM-DD date (BT-2)")
  if (document.currencyCode !== "RON") {
    issues.push(`only RON is supported, got "${document.currencyCode}" (BT-5)`)
  }
  if (document.lines.length === 0) issues.push("a document must carry at least one line")
  if (document.taxSubtotals.length === 0) issues.push("a document must carry at least one VAT breakdown (BR-CO-18)")

  if (document.kind === "credit_note") {
    if (document.precedingInvoice === null) {
      issues.push("a credit note must reference the invoice it corrects (BG-3)")
    }
    // UBL's CreditNote has no DueDate element at all, and the official
    // validator accepted a credit note with neither a due date nor payment
    // terms, so BR-CO-25 does not reach here.
    if (document.dueDate !== null) issues.push("a credit note carries no payment due date (BT-9)")
  } else if (document.dueDate === null) {
    // BR-CO-25: something has to say when a positive amount is due.
    const payable = amountOrSkip(document.payableAmount)
    if (payable !== null && payable !== 0n) {
      issues.push("an invoice with an amount due for payment needs a payment due date (BR-CO-25)")
    }
  } else if (!isCalendarDate(document.dueDate)) {
    issues.push("dueDate must be a valid YYYY-MM-DD date (BT-9)")
  }
  const preceding = document.precedingInvoice
  if (preceding !== null) {
    if (preceding.id.trim().length === 0) issues.push("precedingInvoice.id is required (BT-25)")
    if (!isCalendarDate(preceding.issueDate)) {
      issues.push("precedingInvoice.issueDate must be a valid YYYY-MM-DD date (BT-26)")
    }
  }
}

/**
 * An identifier made of whitespace identifies nobody.
 *
 * The renderer omits an empty element rather than emitting one, so a blank
 * identifier would vanish between the rule that accepted it and the XML that
 * ANAF reads — the document would then fail there for a field we believed was
 * present. Blank is therefore both absent, for the rules below, and refused, so
 * the caller hears about it instead of the identity disappearing in silence.
 */
const stated = (value: string | null): boolean => value !== null && value.trim().length > 0

const checkParties = (document: EFacturaDocument, issues: Array<string>): void => {
  for (const [role, party] of [["seller", document.seller], ["buyer", document.buyer]] as const) {
    if (party.registrationName.trim().length === 0) issues.push(`${role}.registrationName is required`)
    const address = party.address
    if (address.countryCode.length !== 2) issues.push(`${role}.address.countryCode must be ISO 3166-1 alpha-2`)
    if (address.streetName.trim().length === 0) issues.push(`${role}.address.streetName is required`)
    if (address.cityName.trim().length === 0) issues.push(`${role}.address.cityName is required`)
    if (address.countryCode === "RO" && !/^RO-[A-Z]{1,2}$/.test(address.countrySubentity)) {
      issues.push(`${role}.address.countrySubentity must be an ISO 3166-2 code such as RO-CJ`)
    }
    for (const field of ["vatIdentifier", "taxRegistrationIdentifier", "legalRegistrationIdentifier"] as const) {
      const value = party[field]
      if (value !== null && value.trim().length === 0) {
        issues.push(`${role}.${field} is stated but empty; omit it instead of sending nothing`)
      }
    }
  }
  if (!stated(document.seller.vatIdentifier) && !stated(document.seller.taxRegistrationIdentifier)) {
    issues.push("the seller needs either a VAT identifier or a tax registration identifier (BR-RO-065)")
  }
  // BR-RO-120, as returned verbatim by the official validator: the buyer is
  // identified by BT-47 and/or BT-48. Unlike the seller, a buyer's BT-32 does
  // not exist, so a buyer company that is not VAT registered has to be named
  // through its legal registration identifier.
  if (!stated(document.buyer.vatIdentifier) && !stated(document.buyer.legalRegistrationIdentifier)) {
    issues.push("the buyer needs a legal registration identifier or a VAT identifier (BR-RO-120)")
  }
}

export const validateEFacturaDocument = (document: EFacturaDocument): void => {
  const issues: Array<string> = []
  checkIdentity(document, issues)
  checkParties(document, issues)
  checkCiusLimits(document, issues)
  let lineSum: bigint | null = 0n
  for (const [index, line] of document.lines.entries()) {
    const net = checkLine(line, index, issues)
    lineSum = net === null || lineSum === null ? null : lineSum + net
  }
  for (const [index, subtotal] of document.taxSubtotals.entries()) checkVatSubtotal(subtotal, index, issues)
  checkVatGroups(document, issues)
  checkTotals(document, lineSum, issues)
  if (issues.length > 0) throw new EFacturaContractViolation({ issues })
}
