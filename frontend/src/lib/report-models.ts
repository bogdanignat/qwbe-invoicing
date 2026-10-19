import type { PaymentStatus } from "./payment-models.ts"
import type { ReportRange } from "./report-period.ts"

/**
 * The two dashboard reports, as `GET /api/reports/revenue` and
 * `GET /api/reports/collections` answer them (kernel/api/schema-reports.ts).
 *
 * Every amount stays the signed decimal string the backend computed, with two
 * decimals: a month with a storno or a reversed payment can be negative.
 */
export const COLLECTIONS_STATUSES = ["all", "paid", "unpaid", "overdue"] as const
export type CollectionsStatus = typeof COLLECTIONS_STATUSES[number]

export interface RevenueFigures {
  readonly revenueExcludingVat: string
  readonly invoicedIncludingVat: string
  readonly invoiceCount: number
  readonly correctionCount: number
}

export interface RevenueMonth extends RevenueFigures {
  /** `YYYY-MM`; every month of the period is listed, empty ones as zero. */
  readonly month: string
}

export interface RevenueReport extends ReportRange {
  readonly currency: string
  readonly months: ReadonlyArray<RevenueMonth>
  readonly totals: RevenueFigures
}

export interface CollectedMonth {
  readonly month: string
  /** Payments minus reversals by payment date: negative when a reversal outweighs the month. */
  readonly collected: string
}

export interface CollectionInvoice {
  readonly id: string
  readonly series: string
  readonly number: number
  readonly issueDate: string
  readonly dueDate: string | null
  readonly customerName: string
  readonly totalIncludingVat: string
  readonly paidAmount: string
  readonly remainingAmount: string
  /** Today's status, as the backend classified it; never recomputed here. */
  readonly status: PaymentStatus
}

/** The invoices issued in the period that match the filter; the totals cover all of them, `items` at most 50. */
export interface CollectionsSituation {
  readonly count: number
  readonly totalIncludingVat: string
  readonly paidAmount: string
  readonly remainingAmount: string
  readonly overdueCount: number
  readonly overdueAmount: string
  readonly items: ReadonlyArray<CollectionInvoice>
}

export interface CollectionsReport extends ReportRange {
  readonly currency: string
  readonly status: CollectionsStatus
  readonly months: ReadonlyArray<CollectedMonth>
  readonly collected: string
  readonly invoices: CollectionsSituation
}
