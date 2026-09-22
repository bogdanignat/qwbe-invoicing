import type { BuyerSnapshot, IssuerCompanySnapshot, IssuerSnapshot } from "./party-models.ts"
import type { UnitOfMeasure, VatCategoryCode } from "./catalog-models.ts"

export interface DocumentSource {
  readonly app: string
  readonly kind: string
  readonly id: string
}

export interface DraftLine {
  readonly id: string
  readonly description: string
  readonly quantity: string
  readonly unitPrice: string
  readonly unitOfMeasure: UnitOfMeasure
  readonly vatRateCode: string
  readonly vatRate: string
  readonly vatCategoryCode: VatCategoryCode
  readonly vatExemptionReason: string | null
  readonly totalExcludingVat: string
  readonly vatAmount: string
  readonly totalIncludingVat: string
}

export interface VatBreakdown {
  readonly code: string
  readonly rate: string
  readonly vatCategoryCode: VatCategoryCode
  readonly vatExemptionReason: string | null
  readonly vatBaseAmount: string
  readonly vatAmount: string
}

interface DocumentTotals {
  readonly lines: ReadonlyArray<DraftLine>
  readonly vatBreakdown: ReadonlyArray<VatBreakdown>
  readonly totalExcludingVat: string
  readonly vatTotal: string
  readonly totalIncludingVat: string
}

export interface DraftInvoice extends DocumentTotals {
  readonly id: string
  readonly organizationId: string
  readonly customer: BuyerSnapshot
  readonly customerId?: string
  readonly source?: DocumentSource
  readonly sourceProformaId: string | null
  readonly series: string
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly notes: string | null
  readonly status: "draft" | "issued" | "proforma_issued"
}

export interface IssuedInvoice extends DocumentTotals {
  readonly actorId: string
  readonly id: string
  readonly draftId: string | null
  readonly sourceProformaId: string | null
  readonly source?: DocumentSource
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string | null
  readonly currency: string
  readonly notes: string | null
  readonly issuer: IssuerSnapshot
  readonly customer: BuyerSnapshot
  readonly eFacturaStatus: string
}

export interface Proforma extends DocumentTotals {
  readonly actorId: string
  readonly id: string
  readonly sourceDraftId: string | null
  readonly source?: DocumentSource
  readonly organizationId: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string | null
  readonly issuedAt: string
  readonly currency: string
  readonly notes: string | null
  readonly issuer: IssuerSnapshot
  readonly customer: BuyerSnapshot
  readonly convertedDraftId: string | null
  readonly convertedInvoiceId: string | null
}

export type ProformaSummary = Omit<Proforma, "issuer"> & {
  readonly issuer: IssuerCompanySnapshot
}

export interface Payment {
  readonly actorId: string
  readonly id: string
  readonly kind: "payment" | "reversal"
  readonly reversesPaymentId?: string
  readonly amount: string
  readonly currency: string
  readonly paymentDate: string
  readonly method: string
  readonly externalReference?: string
  readonly note?: string
}

export interface PaymentSummary {
  readonly invoiceId: string
  readonly status: "unpaid" | "partially_paid" | "paid" | "overpaid" | "overdue"
  readonly paidAmount: string
  readonly remainingAmount: string
  readonly payments: ReadonlyArray<Payment>
}

export interface CorrectionDocument {
  readonly actorId: string
  readonly id: string
  readonly source?: DocumentSource
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly reason: string
  readonly currency: string
  readonly issuer: IssuerCompanySnapshot
  readonly totalIncludingVat: string
}

export interface Page<Item> {
  readonly items: ReadonlyArray<Item>
  readonly nextCursor: string | null
}

export interface PageRequest {
  readonly limit?: number
  readonly cursor?: string
}
