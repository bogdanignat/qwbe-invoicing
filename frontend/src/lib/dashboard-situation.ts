import { counted, type StatCard } from "./dashboard-view.ts"
import { money, orDash } from "./format.ts"
import { invoiceDetailHref } from "./invoice-register-projection.ts"
import { paymentStatusLabel, paymentStatusTone, type PaymentStatusTone } from "./payment-state.ts"
import type { CollectionsReport, CollectionsSituation } from "./report-models.ts"

/**
 * The invoices block of the dashboard, projected from the collections report:
 * the totals of the whole filtered set, the listed rows and how many of them
 * are shown. Statuses and balances are the backend's; only wording is added.
 */
export interface CollectionRow {
  readonly id: string
  readonly href: string
  readonly number: string
  readonly customerName: string
  readonly issueDate: string
  readonly dueDate: string
  readonly total: string
  readonly paid: string
  readonly remaining: string
  readonly statusLabel: string
  readonly statusTone: PaymentStatusTone
}

export const situationCards = (situation: CollectionsSituation, currency: string): ReadonlyArray<StatCard> => [
  { key: "count", label: "Facturi", value: String(situation.count) },
  { key: "total", label: "Total (cu TVA)", value: money(situation.totalIncludingVat, currency) },
  { key: "paid", label: "Încasat pe ele", value: money(situation.paidAmount, currency), hint: "Toate plățile facturilor, indiferent de dată" },
  { key: "remaining", label: "Sold rămas", value: money(situation.remainingAmount, currency) },
  {
    key: "overdue", label: "Restanțe", value: money(situation.overdueAmount, currency),
    hint: counted(situation.overdueCount, "factură scadentă", "facturi scadente"),
  },
]

export const collectionRows = (situation: CollectionsSituation, currency: string): ReadonlyArray<CollectionRow> =>
  situation.items.map((item) => ({
    id: item.id,
    href: invoiceDetailHref(item.id),
    number: `${item.series} ${String(item.number)}`,
    customerName: item.customerName,
    issueDate: item.issueDate,
    dueDate: orDash(item.dueDate),
    total: money(item.totalIncludingVat, currency),
    paid: money(item.paidAmount, currency),
    remaining: money(item.remainingAmount, currency),
    statusLabel: paymentStatusLabel(item.status),
    statusTone: paymentStatusTone(item.status),
  }))

/** `4 facturi`, or `primele 50 din 56` once the list is cut. */
export const listCount = (situation: CollectionsSituation): string =>
  situation.count > situation.items.length
    ? `primele ${String(situation.items.length)} din ${String(situation.count)}`
    : counted(situation.count, "factură", "facturi")

export interface SituationView {
  readonly cards: ReadonlyArray<StatCard>
  readonly rows: ReadonlyArray<CollectionRow>
  readonly count: string
}

export const situationView = (report: CollectionsReport): SituationView => ({
  cards: situationCards(report.invoices, report.currency),
  rows: collectionRows(report.invoices, report.currency),
  count: listCount(report.invoices),
})
