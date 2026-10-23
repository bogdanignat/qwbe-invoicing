import type { XmlRefusal } from "../../submissions/index.ts"

/**
 * A received UBL invoice or credit note, normalized for display and for the
 * purchase export. Amounts and quantities are the decimal strings of the XML,
 * unrounded, with their sign as written (a credit note is not turned negative).
 * A field the XML does not carry is absent here: never a zero or an empty string.
 */
export interface Amount {
  readonly value: string
  /** The `currencyID` the XML gives the amount. */
  readonly currency: string
}

export interface Quantity {
  readonly value: string
  readonly unit?: string
}

export interface Address {
  readonly street?: string
  readonly city?: string
  /** `CountrySubentity`, the county (`RO-BT`). */
  readonly county?: string
  readonly country?: string
}

export interface ReceivedParty {
  /** `PartyLegalEntity/RegistrationName`, else `PartyName/Name`. */
  readonly name?: string
  /** `PartyTaxScheme/CompanyID` under the `VAT` tax scheme. */
  readonly vatId?: string
  /** `PartyTaxScheme/CompanyID` under any other tax scheme (a CIF without VAT). */
  readonly taxRegistrationId?: string
  /** `PartyLegalEntity/CompanyID`: trade registry number, or the CIF of a buyer without VAT. */
  readonly registrationId?: string
  readonly address?: Address
}

export interface BillingReference {
  readonly number: string
  readonly issueDate?: string
}

export interface AllowanceCharge {
  /** `ChargeIndicator`: true for a charge, false for an allowance. */
  readonly charge: boolean
  readonly amount: Amount
  readonly baseAmount?: Amount
  readonly percent?: string
  readonly reason?: string
  readonly reasonCode?: string
  readonly vatCategory?: string
  readonly vatPercent?: string
}

export interface MonetaryTotals {
  readonly lineExtension: Amount
  readonly taxExclusive: Amount
  readonly taxInclusive: Amount
  readonly allowanceTotal?: Amount
  readonly chargeTotal?: Amount
  readonly prepaid?: Amount
  readonly rounding?: Amount
  readonly payable: Amount
}

export interface VatBreakdown {
  readonly category: string
  readonly percent?: string
  readonly taxable: Amount
  readonly tax: Amount
  readonly exemptionCode?: string
  readonly exemptionReason?: string
}

export interface Vat {
  /** `TaxTotal/TaxAmount` in the document's currency. */
  readonly total?: Amount
  /** `TaxTotal/TaxAmount` in `TaxCurrencyCode`, when that is another currency. */
  readonly taxCurrencyTotal?: Amount
  readonly breakdown: ReadonlyArray<VatBreakdown>
}

export interface ItemCode {
  readonly value: string
  /** `schemeID` of a standard identifier, `listID` of a classification. */
  readonly scheme?: string
}

export interface ReceivedLine {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly quantity?: Quantity
  readonly priceBaseQuantity?: Quantity
  readonly unitPrice?: Amount
  readonly netAmount: Amount
  readonly vatCategory?: string
  readonly vatPercent?: string
  readonly allowanceCharges: ReadonlyArray<AllowanceCharge>
  readonly sellerItemId?: string
  readonly standardItemId?: ItemCode
  readonly classifications: ReadonlyArray<ItemCode>
}

export type ReceivedKind = "invoice" | "credit_note"

export interface ReceivedDocument {
  readonly kind: ReceivedKind
  /** `InvoiceTypeCode` / `CreditNoteTypeCode`: 380, 381, 384, 389, 751… */
  readonly typeCode?: string
  readonly number: string
  readonly issueDate: string
  /** `DueDate`, else the `PaymentMeans/PaymentDueDate` all payment means agree on. */
  readonly dueDate?: string
  readonly currency: string
  readonly taxCurrency?: string
  readonly notes: ReadonlyArray<string>
  readonly supplier: ReceivedParty
  readonly buyer: ReceivedParty
  /** `PaymentMeans/PayeeFinancialAccount/ID`: the IBANs to pay into. */
  readonly paymentAccounts: ReadonlyArray<string>
  readonly billingReferences: ReadonlyArray<BillingReference>
  readonly orderReference?: string
  readonly contractReferences: ReadonlyArray<string>
  readonly allowanceCharges: ReadonlyArray<AllowanceCharge>
  readonly totals: MonetaryTotals
  readonly vat: Vat
  readonly lines: ReadonlyArray<ReceivedLine>
}

export type ReceivedWarning =
  | { readonly code: "lines_total_mismatch" | "tax_inclusive_mismatch"; readonly declared: string; readonly computed: string }
  | { readonly code: "buyer_cif_mismatch"; readonly expected: string; readonly found: ReadonlyArray<string> }

/** Why the XML could not be read: the parser's refusal, a root that is no UBL document, or a field by its path. */
export type ReadFailure =
  | { readonly reason: "xml"; readonly refusal: XmlRefusal }
  | { readonly reason: "not_ubl" }
  | { readonly reason: "unbound_prefix" | "missing" | "duplicate" | "invalid"; readonly field: string }

export type ReceivedRead =
  | { readonly ok: true; readonly document: ReceivedDocument; readonly warnings: ReadonlyArray<ReceivedWarning> }
  | { readonly ok: false; readonly failure: ReadFailure }
