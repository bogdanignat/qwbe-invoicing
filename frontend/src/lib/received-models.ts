/**
 * The received invoices of the e-Factura plugin as the API answers them
 * (`kernel/api/schema-efactura-received.ts`). Amounts and quantities are the
 * XML's own decimal strings, unrounded; a field the XML lacks is absent.
 */
export type ReceivedKind = "invoice" | "credit_note"
export type TotalsWarningCode = "lines_total_mismatch" | "tax_inclusive_mismatch"
export type ReceivedWarningCode = TotalsWarningCode | "buyer_cif_mismatch"

export interface ReceivedListing {
  readonly kind: ReceivedKind
  readonly number: string
  readonly issueDate: string
  readonly currency: string
  readonly supplierName: string
  readonly supplierCif: string
  readonly totalExcludingTax: string
  readonly taxTotal: string
  readonly payable: string
}

export type UblFailure =
  | { readonly reason: "xml"; readonly refusal: string }
  | { readonly reason: "not_ubl" }
  | { readonly reason: "unbound_prefix" | "missing" | "duplicate" | "invalid"; readonly field: string }

export type UnreadableReason =
  | { readonly source: "zip"; readonly refusal: string }
  | { readonly source: "encoding" }
  | { readonly source: "ubl"; readonly failure: UblFailure }

export interface ReceivedMessage {
  /** ANAF's message id: the `{id}` of the detail and archive routes. */
  readonly messageId: string
  /** ANAF's `data_creare`: `YYYYMMDDHHmm`, Romanian time. */
  readonly spvCreatedAt: string
  readonly storedAt: string
}

export type Unreadable = { readonly readable: false; readonly reason: UnreadableReason }

export type ReceivedSummary = ReceivedMessage & (
  | {
    readonly readable: true
    readonly listing: ReceivedListing
    readonly dueDate: string | undefined
    readonly warnings: ReadonlyArray<ReceivedWarningCode>
  }
  | Unreadable)

export type ReceivedWarning =
  | { readonly code: TotalsWarningCode; readonly declared: string; readonly computed: string }
  | { readonly code: "buyer_cif_mismatch"; readonly expected: string; readonly found: ReadonlyArray<string> }

export interface Amount { readonly value: string; readonly currency: string }
export interface Quantity { readonly value: string; readonly unit: string | undefined }

export interface ReceivedAddress {
  readonly street: string | undefined
  readonly city: string | undefined
  readonly county: string | undefined
  readonly country: string | undefined
}

export interface ReceivedParty {
  readonly name: string | undefined
  readonly vatId: string | undefined
  readonly taxRegistrationId: string | undefined
  readonly registrationId: string | undefined
  readonly address: ReceivedAddress | undefined
}

export interface ReceivedVatRow {
  readonly category: string
  readonly percent: string | undefined
  readonly taxable: Amount
  readonly tax: Amount
  readonly exemptionReason: string | undefined
}

export interface ReceivedLine {
  readonly id: string
  readonly name: string | undefined
  readonly description: string | undefined
  readonly quantity: Quantity | undefined
  readonly priceBaseQuantity: Quantity | undefined
  readonly unitPrice: Amount | undefined
  readonly netAmount: Amount
  readonly vatCategory: string | undefined
  readonly vatPercent: string | undefined
}

export interface ReceivedTotals {
  readonly lineExtension: Amount
  readonly taxExclusive: Amount
  readonly taxInclusive: Amount
  readonly allowanceTotal: Amount | undefined
  readonly chargeTotal: Amount | undefined
  readonly prepaid: Amount | undefined
  readonly rounding: Amount | undefined
  readonly payable: Amount
}

/** The part of the normalized document the detail shows. */
export interface ReceivedDocument {
  readonly dueDate: string | undefined
  readonly currency: string
  readonly notes: ReadonlyArray<string>
  readonly supplier: ReceivedParty
  readonly buyer: ReceivedParty
  readonly paymentAccounts: ReadonlyArray<string>
  readonly totals: ReceivedTotals
  readonly vatTotal: Amount | undefined
  /** The VAT in `TaxCurrencyCode` (RON for an invoice in EUR), when the document gives one. */
  readonly vatInTaxCurrency: Amount | undefined
  readonly vatRows: ReadonlyArray<ReceivedVatRow>
  readonly lines: ReadonlyArray<ReceivedLine>
}

export type ReceivedDetail = ReceivedMessage & (
  | {
    readonly readable: true
    readonly listing: ReceivedListing
    readonly document: ReceivedDocument
    readonly warnings: ReadonlyArray<ReceivedWarning>
  }
  | Unreadable)

export type FetchState = "listing" | "downloading" | "completed" | "failed"

export interface ReceivedFetch {
  readonly id: string
  readonly state: FetchState
  readonly window: {
    readonly start: string
    readonly end: string
    /** Days between the last coverage and `start` that ANAF no longer lists. */
    readonly gap: { readonly from: string; readonly until: string } | undefined
  }
  readonly pagesListed: number
  readonly pagesTotal: number
  readonly found: number
  readonly queued: number
  readonly downloaded: number
  readonly failed: number
  readonly errors: ReadonlyArray<string>
}

export interface ReceivedStatus {
  readonly fetch: ReceivedFetch | null
  /** Received invoices are fetched completely up to here; null before the first complete fetch. */
  readonly coveredUntil: string | null
}
