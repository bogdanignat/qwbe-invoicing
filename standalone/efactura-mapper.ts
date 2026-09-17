import type { EFacturaDocument, EFacturaLine, EFacturaParty, EFacturaTaxSubtotal } from "../cube/efactura/index.ts"
import { ANONYMOUS_BUYER_IDENTIFIER, EFacturaContractViolation, validateEFacturaDocument } from "../cube/efactura/index.ts"
import type { Address, BuyerSnapshot, CorrectionDocument, DraftLine, IssuedInvoice, IssuerCompanySnapshot, VatBreakdown } from "../cube/invoicing/index.ts"
import { isValidRomanianCnp, validateFiscalDocument } from "../cube/invoicing/index.ts"

/**
 * Translates frozen invoicing snapshots into the e-Factura contract.
 *
 * This lives in the host, not in either cube: it is the only place that knows
 * both models. It reads snapshots only — never a live issuer profile, never
 * the current VAT catalogue — because an invoice must keep rendering the facts
 * it was issued with, whatever the seller's status is today.
 */

/** BT-1 must match what the PDF prints, so the two documents name the same
 * invoice. pdf-renderer composes `series number`; this must not drift. */
export const documentNumber = (document: { readonly series: string; readonly number: number }): string =>
  `${document.series} ${String(document.number)}`

/** CUI is stored without the `RO` prefix and the prefix is derived for display.
 * Derive it the same way here, tolerating a stored prefix rather than emitting
 * `RORO123`. */
const vatIdentifier = (fiscalIdentifier: string): string =>
  `RO${fiscalIdentifier.trim().replace(/^RO/iu, "")}`

/** For Bucharest the sector is the administrative city-level unit, so it
 * occupies BT-37/BT-52; elsewhere the stored city name is used as-is. */
const address = (source: Address) => ({
  countryCode: source.countryCode,
  cityName: source.county === "RO-B" && source.sector !== undefined ? `SECTOR${String(source.sector)}` : source.city,
  streetName: source.street,
  countrySubentity: source.county,
  postalZone: source.postalCode ?? null,
})

const seller = (issuer: IssuerCompanySnapshot): EFacturaParty => ({
  registrationName: issuer.name,
  address: address(issuer.address),
  vatIdentifier: issuer.vatRegistered ? vatIdentifier(issuer.fiscalIdentifier) : null,
  // BR-RO-065 accepts the seller's tax registration identifier when there is no
  // VAT identifier; an Article 310 issuer still has a CUI, just not a VAT one.
  taxRegistrationIdentifier: issuer.vatRegistered ? null : issuer.fiscalIdentifier.trim() || null,
  legalRegistrationIdentifier: issuer.tradeRegistryNumber.trim() || null,
})

/**
 * BT-47 for a private individual: their CNP when the invoice carries a usable
 * one, the anonymous placeholder otherwise.
 *
 * The CNP is optional in the product and the validator accepts both forms. The
 * stored value is re-checked rather than trusted, because BT-47 is the buyer's
 * identity: a malformed CNP would name the wrong person instead of nobody.
 */
const consumerIdentifier = (fiscalIdentifier: string): string => {
  const cnp = fiscalIdentifier.trim()
  return isValidRomanianCnp(cnp) ? cnp : ANONYMOUS_BUYER_IDENTIFIER
}

/**
 * A buyer is identified by BT-47 and/or BT-48 (BR-RO-120).
 *
 * BT-32 has no buyer equivalent in EN 16931, so a company buyer that is not
 * VAT registered is named through BT-47 — its CUI — rather than through a tax
 * scheme the standard reserves for the seller.
 */
const buyer = (customer: BuyerSnapshot): EFacturaParty => ({
  registrationName: customer.name,
  address: address(customer.address),
  vatIdentifier: customer.partyType === "company" && customer.vatRegistered
    ? vatIdentifier(customer.fiscalIdentifier) : null,
  taxRegistrationIdentifier: null,
  legalRegistrationIdentifier: customer.partyType === "company"
    ? customer.fiscalIdentifier.trim() || null : consumerIdentifier(customer.fiscalIdentifier),
})

const mapLine = (line: DraftLine, position: number): EFacturaLine => ({
  id: String(position + 1),
  name: line.description,
  quantity: line.quantity,
  unitCode: line.unitOfMeasure.code,
  netAmount: line.totalExcludingVat,
  unitPrice: line.unitPrice,
  vatCategory: line.vatCategoryCode,
  vatRate: line.vatRate,
})

const mapSubtotal = (breakdown: VatBreakdown): EFacturaTaxSubtotal => ({
  taxableAmount: breakdown.vatBaseAmount,
  taxAmount: breakdown.vatAmount,
  category: breakdown.vatCategoryCode,
  percent: breakdown.rate,
  exemptionReason: breakdown.vatExemptionReason,
  // BT-121. The invoicing model stores only the exemption *text* today, and it
  // knows no `O` category, so there is no VATEX code to carry: `E` is accepted
  // by BR-E-10 on the text alone. If the Article 310 treatment moves to `O`,
  // this is where the code it mandates comes from — not a default invented
  // here, because the wrong VATEX code states the wrong legal ground.
  exemptionReasonCode: null,
})

export const mapIssuedInvoice = (invoice: IssuedInvoice): EFacturaDocument => {
  const document: EFacturaDocument = {
    kind: "invoice",
    id: documentNumber(invoice),
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    currencyCode: invoice.currency,
    note: invoice.notes,
    precedingInvoice: null,
    seller: seller(invoice.issuer),
    buyer: buyer(invoice.customer),
    // BG-16 is omitted: holding the seller's IBAN is not evidence of the
    // payment means agreed with the buyer, and BT-81 has no source in the
    // snapshot. Guessing a code would assert something the invoice never said.
    paymentMeans: null,
    lines: invoice.lines.map(mapLine),
    taxSubtotals: invoice.vatBreakdown.map(mapSubtotal),
    lineExtensionAmount: invoice.totalExcludingVat,
    taxExclusiveAmount: invoice.totalExcludingVat,
    taxAmount: invoice.vatTotal,
    taxInclusiveAmount: invoice.totalIncludingVat,
    payableAmount: invoice.totalIncludingVat,
  }
  validateEFacturaDocument(document)
  return document
}

/** Strips the negation a correction stores internally. A value that is neither
 * negative nor zero means the correction disagrees with its own semantics, so
 * it is reported rather than passed through `Math.abs`, which would hide it. */
const unnegate = (value: string, field: string, issues: Array<string>): string => {
  if (value.startsWith("-")) return value.slice(1)
  if (/^0+(?:\.0+)?$/.test(value)) return value
  issues.push(`${field} is expected to be negative on a correction, got "${value}"`)
  return value
}

const creditLine = (line: DraftLine, index: number, issues: Array<string>): DraftLine => {
  const where = `lines[${String(index)}]`
  return {
    ...line,
    totalExcludingVat: unnegate(line.totalExcludingVat, `${where}.totalExcludingVat`, issues),
    vatAmount: unnegate(line.vatAmount, `${where}.vatAmount`, issues),
    totalIncludingVat: unnegate(line.totalIncludingVat, `${where}.totalIncludingVat`, issues),
  }
}

const fiscalFingerprint = (document: {
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
}): string => JSON.stringify([
  // Line identifiers are deliberately excluded: a correction owns its own row
  // ids, but every fiscal value must match the invoice it reverses.
  document.lines.map(({ description, quantity, unitPrice, unitOfMeasure, vatRateCode, vatRate, vatCategoryCode,
    vatExemptionReason, totalExcludingVat, vatAmount, totalIncludingVat }) => [description, quantity, unitPrice,
    unitOfMeasure.code, unitOfMeasure.name, vatRateCode, vatRate, vatCategoryCode, vatExemptionReason,
    totalExcludingVat, vatAmount, totalIncludingVat]),
  document.vatBreakdown.map(({ code, rate, vatCategoryCode, vatExemptionReason, vatBaseAmount, vatAmount }) =>
    [code, rate, vatCategoryCode, vatExemptionReason, vatBaseAmount, vatAmount]).toSorted(),
  document.totalExcludingVat, document.vatTotal, document.totalIncludingVat,
])

/**
 * Maps a full correction to a credit note.
 *
 * UBL expresses a credit note in positive amounts — the document type says it
 * is a credit, the numbers do not. The internally negated snapshot is turned
 * back into that positive view, but only after proving the negation was
 * coherent and that the result still reconciles, line for line, with the
 * invoice being reversed.
 */
export const mapCorrection = (correction: CorrectionDocument, original: IssuedInvoice): EFacturaDocument => {
  const issues: Array<string> = []
  if (correction.originalInvoiceId !== original.id) {
    issues.push("the supplied original invoice is not the one this correction reverses")
  }
  if (correction.organizationId !== original.organizationId) {
    issues.push("the correction and its original invoice belong to different organizations")
  }
  if (issues.length > 0) throw new EFacturaContractViolation({ issues })

  const lines = correction.lines.map((line, index) => creditLine(line, index, issues))
  const vatBreakdown = correction.vatBreakdown.map((breakdown, index) => ({
    ...breakdown,
    vatBaseAmount: unnegate(breakdown.vatBaseAmount, `vatBreakdown[${String(index)}].vatBaseAmount`, issues),
    vatAmount: unnegate(breakdown.vatAmount, `vatBreakdown[${String(index)}].vatAmount`, issues),
  }))
  const credit = {
    lines,
    vatBreakdown,
    totalExcludingVat: unnegate(correction.totalExcludingVat, "totalExcludingVat", issues),
    vatTotal: unnegate(correction.vatTotal, "vatTotal", issues),
    totalIncludingVat: unnegate(correction.totalIncludingVat, "totalIncludingVat", issues),
  }
  if (issues.length > 0) throw new EFacturaContractViolation({ issues })

  // Both sides must stand on their own before they are compared, so an
  // inconsistency is reported against the document that actually carries it.
  for (const [label, document] of [["the original invoice", original], ["the credit note", credit]] as const) {
    try {
      validateFiscalDocument(document)
    } catch {
      issues.push(`${label} does not recalculate consistently`)
    }
  }
  if (issues.length === 0 && fiscalFingerprint(credit) !== fiscalFingerprint(original)) {
    issues.push("the credit note does not reverse the original invoice exactly")
  }
  if (issues.length > 0) throw new EFacturaContractViolation({ issues })

  const document: EFacturaDocument = {
    kind: "credit_note",
    id: documentNumber(correction),
    issueDate: correction.issueDate,
    // A credit note is not a demand for payment, so it carries no due date.
    dueDate: null,
    currencyCode: correction.currency,
    note: correction.reason,
    precedingInvoice: { id: documentNumber(original), issueDate: original.issueDate },
    seller: seller(correction.issuer),
    buyer: buyer(correction.customer),
    paymentMeans: null,
    lines: lines.map(mapLine),
    taxSubtotals: vatBreakdown.map(mapSubtotal),
    lineExtensionAmount: credit.totalExcludingVat,
    taxExclusiveAmount: credit.totalExcludingVat,
    taxAmount: credit.vatTotal,
    taxInclusiveAmount: credit.totalIncludingVat,
    payableAmount: credit.totalIncludingVat,
  }
  validateEFacturaDocument(document)
  return document
}
