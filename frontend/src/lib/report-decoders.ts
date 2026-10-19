import { array, integer, literal, nullableText, object, text, type Decoder } from "./model-decoder.ts"
import { PAYMENT_STATUSES } from "./payment-models.ts"
import {
  COLLECTIONS_STATUSES,
  type CollectedMonth, type CollectionInvoice, type CollectionsReport, type CollectionsSituation,
  type RevenueFigures, type RevenueMonth, type RevenueReport,
} from "./report-models.ts"

/**
 * The chart turns these strings into bar heights, so a malformed amount is
 * refused here rather than drawn as a bar of `NaN`: signed, two decimals.
 */
const amount = (input: unknown, field: string): string => {
  const value = text(input, field)
  if (!/^-?\d+\.\d{2}$/u.test(value)) throw new Error(`invalid ${field}`)
  return value
}

const month = (input: unknown): string => {
  const value = text(input, "month")
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(value)) throw new Error("invalid month")
  return value
}

const revenueFigures = (input: unknown): RevenueFigures => {
  const value = object(input)
  return {
    revenueExcludingVat: amount(value.revenueExcludingVat, "revenueExcludingVat"),
    invoicedIncludingVat: amount(value.invoicedIncludingVat, "invoicedIncludingVat"),
    invoiceCount: integer(value.invoiceCount, "invoiceCount"),
    correctionCount: integer(value.correctionCount, "correctionCount"),
  }
}

const revenueMonth: Decoder<RevenueMonth> = (input) => ({ month: month(object(input).month), ...revenueFigures(input) })

export const decodeRevenueReport: Decoder<RevenueReport> = (input) => {
  const value = object(input)
  return {
    from: text(value.from, "from"),
    to: text(value.to, "to"),
    currency: text(value.currency, "currency"),
    months: array(value.months, revenueMonth, "months"),
    totals: revenueFigures(value.totals),
  }
}

const collectedMonth: Decoder<CollectedMonth> = (input) => {
  const value = object(input)
  return { month: month(value.month), collected: amount(value.collected, "collected") }
}

const collectionInvoice: Decoder<CollectionInvoice> = (input) => {
  const value = object(input)
  return {
    id: text(value.id, "id"),
    series: text(value.series, "series"),
    number: integer(value.number, "number"),
    issueDate: text(value.issueDate, "issueDate"),
    dueDate: nullableText(value.dueDate, "dueDate"),
    customerName: text(object(value.customer).name, "customer.name"),
    totalIncludingVat: amount(value.totalIncludingVat, "totalIncludingVat"),
    paidAmount: amount(value.paidAmount, "paidAmount"),
    remainingAmount: amount(value.remainingAmount, "remainingAmount"),
    status: literal(PAYMENT_STATUSES, value.status, "status"),
  }
}

const situation = (input: unknown): CollectionsSituation => {
  const value = object(input)
  return {
    count: integer(value.count, "count"),
    totalIncludingVat: amount(value.totalIncludingVat, "totalIncludingVat"),
    paidAmount: amount(value.paidAmount, "paidAmount"),
    remainingAmount: amount(value.remainingAmount, "remainingAmount"),
    overdueCount: integer(value.overdueCount, "overdueCount"),
    overdueAmount: amount(value.overdueAmount, "overdueAmount"),
    items: array(value.items, collectionInvoice, "items"),
  }
}

export const decodeCollectionsReport: Decoder<CollectionsReport> = (input) => {
  const value = object(input)
  return {
    from: text(value.from, "from"),
    to: text(value.to, "to"),
    currency: text(value.currency, "currency"),
    status: literal(COLLECTIONS_STATUSES, value.status, "status"),
    months: array(value.months, collectedMonth, "months"),
    collected: amount(value.collected, "collected"),
    invoices: situation(value.invoices),
  }
}
