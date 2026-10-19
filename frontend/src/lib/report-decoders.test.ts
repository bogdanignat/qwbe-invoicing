import assert from "node:assert/strict"
import test from "node:test"

import { decodeCollectionsReport, decodeRevenueReport } from "./report-decoders.ts"

/** Shapes as kernel/api/schema-reports.ts answers them. */
const figures = { revenueExcludingVat: "-100.00", invoicedIncludingVat: "-121.00", invoiceCount: 0, correctionCount: 1 }
const revenue = {
  from: "2026-07-01", to: "2026-08-31", currency: "RON",
  months: [
    { month: "2026-07", revenueExcludingVat: "200.00", invoicedIncludingVat: "242.00", invoiceCount: 1, correctionCount: 0 },
    { month: "2026-08", ...figures },
  ],
  totals: { revenueExcludingVat: "100.00", invoicedIncludingVat: "121.00", invoiceCount: 1, correctionCount: 1 },
}
const item = {
  id: "inv-4", series: "REP", number: 5, issueDate: "2026-09-01", dueDate: null, customer: { name: "Client SRL" },
  totalIncludingVat: "0.00", paidAmount: "0.00", remainingAmount: "0.00", status: "unpaid",
}
const collections = {
  from: "2026-07-01", to: "2026-09-30", currency: "RON", status: "all",
  months: [{ month: "2026-07", collected: "50.00" }, { month: "2026-09", collected: "-172.00" }],
  collected: "-122.00",
  invoices: {
    count: 1, totalIncludingVat: "0.00", paidAmount: "0.00", remainingAmount: "0.00", overdueCount: 0, overdueAmount: "0.00",
    items: [item],
  },
}

void test("a revenue report keeps a storno month negative, exactly as written", () => {
  const decoded = decodeRevenueReport(revenue)
  assert.deepEqual(decoded.months[1], { month: "2026-08", ...figures })
  assert.equal(decoded.totals.invoicedIncludingVat, "121.00")
})

void test("a collections report keeps a negative month and an invoice without a due date", () => {
  const decoded = decodeCollectionsReport(collections)
  assert.deepEqual(decoded.months.map((entry) => entry.collected), ["50.00", "-172.00"])
  assert.equal(decoded.collected, "-122.00")
  assert.deepEqual(decoded.invoices.items[0], {
    id: "inv-4", series: "REP", number: 5, issueDate: "2026-09-01", dueDate: null, customerName: "Client SRL",
    totalIncludingVat: "0.00", paidAmount: "0.00", remainingAmount: "0.00", status: "unpaid",
  })
})

void test("an amount the chart could not draw is refused at the boundary", () => {
  for (const collected of ["12.3", "1,00", "-", "1e3", " 1.00", "--1.00"]) {
    assert.throws(() => decodeCollectionsReport({ ...collections, collected }), /invalid collected/u, collected)
  }
  assert.throws(() => decodeRevenueReport({ ...revenue, totals: { ...revenue.totals, invoiceCount: 1.5 } }), /invoiceCount/u)
  assert.throws(() => decodeRevenueReport({ ...revenue, months: [{ ...revenue.months[0], month: "2026-13" }] }), /month/u)
})

void test("an unknown status, either the filter or an invoice's, is refused rather than rendered blank", () => {
  assert.throws(() => decodeCollectionsReport({ ...collections, status: "open" }), /invalid status/u)
  assert.throws(() => decodeCollectionsReport({
    ...collections, invoices: { ...collections.invoices, items: [{ ...item, status: "settled" }] },
  }), /invalid status/u)
  assert.throws(() => decodeCollectionsReport({ ...collections, invoices: { ...collections.invoices, items: [{ ...item, customer: null }] } }))
})
