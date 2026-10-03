/**
 * The frozen fiscal documents, as this read-only screen needs them.
 *
 * Both an invoice and a correction are snapshots the backend sealed at
 * issuance: the parties, the lines and the VAT breakdown are copies taken then,
 * not links to records that can still move. They are modelled together because
 * they share that whole body and differ only at the head — an invoice carries a
 * due date, notes and an e-Factura status, a correction carries the reason and
 * the invoice it reverses.
 *
 * Issuer branding is deliberately absent: it exists for the rendered PDF, and
 * the document served here is the PDF itself.
 */
import type { EFacturaStatus } from "./invoice-register.ts"

export interface Address {
  readonly countryCode: string
  readonly city: string
  readonly street: string
  readonly county: string
  readonly sector?: number
  readonly postalCode?: string
}

export interface Party {
  readonly name: string
  readonly fiscalIdentifier: string
  readonly address: Address
}

export interface IssuerSnapshot extends Party {
  readonly legalForm: string
  readonly tradeRegistryNumber: string
  readonly iban: string
  readonly bankName: string
  readonly socialCapital: string
  readonly vatRegistered: boolean
}

export interface BuyerSnapshot extends Party {
  readonly partyType: "company" | "individual"
  readonly vatRegistered: boolean
}

export interface UnitOfMeasure {
  readonly code: string
  readonly name: string
}

export interface DocumentLine {
  readonly id: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
  readonly vatRate: string
  readonly vatCategoryCode: string
  readonly vatExemptionReason: string | null
  readonly totalExcludingVat: string
  readonly vatAmount: string
  readonly totalIncludingVat: string
}

export interface VatBreakdownEntry {
  readonly code: string
  readonly rate: string
  readonly vatCategoryCode: string
  readonly vatExemptionReason: string | null
  readonly vatBaseAmount: string
  readonly vatAmount: string
}

/**
 * The whole sealed body, named because a third document shares it.
 *
 * A proforma is not a fiscal document, but the backend seals the same body into
 * it — the two parties, the lines, the VAT breakdown and the totals are copies
 * taken at issuance there too. Modelling it over this interface is what lets one
 * decoder and one projection serve all three; what a proforma does *not* share
 * is the head (no e-Factura status, and the conversion ids instead), which is
 * exactly why it is not modelled as an `IssuedInvoice`.
 */
export interface DocumentBody {
  readonly issuer: IssuerSnapshot
  readonly customer: BuyerSnapshot
  readonly lines: ReadonlyArray<DocumentLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdownEntry>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
  readonly currency: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
}

export interface IssuedInvoice extends DocumentBody {
  readonly id: string
  readonly dueDate: string | null
  readonly notes: string | null
  readonly eFacturaStatus: EFacturaStatus
}

export interface CorrectionDocument extends DocumentBody {
  readonly id: string
  readonly originalInvoiceId: string
  readonly reason: string
}
