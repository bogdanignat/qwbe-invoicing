import type { EFacturaDocument, EFacturaLine, EFacturaTaxSubtotal } from "./contracts/document.ts"
import { DEFAULT_CIUS_RO_PROFILE, type EFacturaProfile } from "./profile.ts"
import { party } from "./ubl-party.ts"
import { validateEFacturaDocument } from "./validation.ts"
import { element, optional, renderXmlDocument, text, type XmlElement } from "./xml.ts"

/**
 * Renders the fiscal contract as UBL 2.1.
 *
 * Every element order below follows the `xsd:sequence` of the official OASIS
 * schemas; the sequences are not alphabetical and not negotiable, so the
 * builders are written top-to-bottom in schema order deliberately.
 */

const INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
const CREDIT_NOTE_NS = "urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"
const CAC = "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
const CBC = "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"

/** BT-3 — UNCL1001 document type codes. */
const INVOICE_TYPE_CODE = "380"
const CREDIT_NOTE_TYPE_CODE = "381"

const amount = (name: string, value: string, currency: string): XmlElement =>
  text(name, value, [["currencyID", currency]])

/** cac:TaxCategoryType — ID, Percent, TaxExemptionReasonCode,
 * TaxExemptionReason, TaxScheme. Percent is absent for category O. */
const taxCategory = (name: string, source: {
  readonly category: string
  readonly percent: string | null
  readonly exemptionReasonCode?: string | null
  readonly exemptionReason?: string | null
}): XmlElement => element(name, [
  text("cbc:ID", source.category),
  ...optional("cbc:Percent", source.percent),
  ...optional("cbc:TaxExemptionReasonCode", source.exemptionReasonCode),
  ...optional("cbc:TaxExemptionReason", source.exemptionReason),
  element("cac:TaxScheme", [text("cbc:ID", "VAT")]),
])

const taxSubtotal = (subtotal: EFacturaTaxSubtotal, currency: string): XmlElement =>
  element("cac:TaxSubtotal", [
    amount("cbc:TaxableAmount", subtotal.taxableAmount, currency),
    amount("cbc:TaxAmount", subtotal.taxAmount, currency),
    taxCategory("cac:TaxCategory", subtotal),
  ])

const taxTotal = (document: EFacturaDocument): XmlElement =>
  element("cac:TaxTotal", [
    amount("cbc:TaxAmount", document.taxAmount, document.currencyCode),
    ...document.taxSubtotals.map((subtotal) => taxSubtotal(subtotal, document.currencyCode)),
  ])

/** cac:MonetaryTotalType. Allowance, charge and prepaid totals are omitted
 * rather than sent as zero: they are genuinely absent, not zero-valued. */
const legalMonetaryTotal = (document: EFacturaDocument): XmlElement =>
  element("cac:LegalMonetaryTotal", [
    amount("cbc:LineExtensionAmount", document.lineExtensionAmount, document.currencyCode),
    amount("cbc:TaxExclusiveAmount", document.taxExclusiveAmount, document.currencyCode),
    amount("cbc:TaxInclusiveAmount", document.taxInclusiveAmount, document.currencyCode),
    amount("cbc:PayableAmount", document.payableAmount, document.currencyCode),
  ])

/** cac:InvoiceLineType / cac:CreditNoteLineType. The two differ in the
 * quantity element name only — `InvoicedQuantity` against `CreditedQuantity`
 * — which is exactly the kind of detail a shared builder must not blur. */
const documentLine = (line: EFacturaLine, currency: string, quantityName: string, lineName: string): XmlElement =>
  element(lineName, [
    text("cbc:ID", line.id),
    text(quantityName, line.quantity, [["unitCode", line.unitCode]]),
    amount("cbc:LineExtensionAmount", line.netAmount, currency),
    element("cac:Item", [
      text("cbc:Name", line.name),
      taxCategory("cac:ClassifiedTaxCategory", { category: line.vatCategory, percent: line.vatRate }),
    ]),
    element("cac:Price", [amount("cbc:PriceAmount", line.unitPrice, currency)]),
  ])

/** BG-3 — the invoice a credit note corrects. */
const billingReference = (document: EFacturaDocument): ReadonlyArray<XmlElement> =>
  document.precedingInvoice === null ? [] : [element("cac:BillingReference", [
    element("cac:InvoiceDocumentReference", [
      text("cbc:ID", document.precedingInvoice.id),
      text("cbc:IssueDate", document.precedingInvoice.issueDate),
    ]),
  ])]

const header = (document: EFacturaDocument, profile: EFacturaProfile,
  typeCodeName: string, typeCode: string): ReadonlyArray<XmlElement> => [
  ...optional("cbc:UBLVersionID", profile.ublVersionId),
  text("cbc:CustomizationID", profile.customizationId),
  text("cbc:ProfileID", profile.profileId),
  text("cbc:ID", document.id),
  text("cbc:IssueDate", document.issueDate),
  // A credit note has no cbc:DueDate at all in the UBL sequence, so the
  // caller never gets the chance to place one.
  ...(document.kind === "invoice" ? optional("cbc:DueDate", document.dueDate) : []),
  text(typeCodeName, typeCode),
  ...optional("cbc:Note", document.note),
  text("cbc:DocumentCurrencyCode", document.currencyCode),
]

const root = (document: EFacturaDocument, profile: EFacturaProfile): XmlElement => {
  const isInvoice = document.kind === "invoice"
  const namespace = isInvoice ? INVOICE_NS : CREDIT_NOTE_NS
  return {
    name: isInvoice ? "Invoice" : "CreditNote",
    attributes: [["xmlns", namespace], ["xmlns:cac", CAC], ["xmlns:cbc", CBC]],
    children: [
      ...header(document, profile,
        isInvoice ? "cbc:InvoiceTypeCode" : "cbc:CreditNoteTypeCode",
        isInvoice ? INVOICE_TYPE_CODE : CREDIT_NOTE_TYPE_CODE),
      ...billingReference(document),
      party("cac:AccountingSupplierParty", document.seller, profile),
      party("cac:AccountingCustomerParty", document.buyer, profile),
      taxTotal(document),
      legalMonetaryTotal(document),
      ...document.lines.map((line) => isInvoice
        ? documentLine(line, document.currencyCode, "cbc:InvoicedQuantity", "cac:InvoiceLine")
        : documentLine(line, document.currencyCode, "cbc:CreditedQuantity", "cac:CreditNoteLine")),
    ],
  }
}

/**
 * Renders a validated document to UBL 2.1 XML.
 *
 * Validation runs here rather than at the call site so no path can reach the
 * renderer with an unchecked document. The result is deterministic: identical
 * input always produces identical bytes, which is what lets a validation
 * verdict be tied to the exact bytes it approved.
 */
export const renderEFacturaXml = (document: EFacturaDocument,
  profile: EFacturaProfile = DEFAULT_CIUS_RO_PROFILE): string => {
  validateEFacturaDocument(document)
  return renderXmlDocument(root(document, profile))
}
