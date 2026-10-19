import assert from "node:assert/strict"
import test from "node:test"

import { listCount, situationView } from "./dashboard-situation.ts"
import { counted, monthLabel, periodCaption, periodView } from "./dashboard-view.ts"
import type { CollectionsReport, RevenueReport } from "./report-models.ts"
import { chartDescription, revenueChartModel } from "./revenue-chart.ts"

const zero = { revenueExcludingVat: "0.00", invoicedIncludingVat: "0.00", invoiceCount: 0, correctionCount: 0 }
const revenue: RevenueReport = {
  from: "2026-07-01", to: "2026-09-30", currency: "RON",
  months: [
    { month: "2026-07", revenueExcludingVat: "200.00", invoicedIncludingVat: "242.00", invoiceCount: 1, correctionCount: 0 },
    { month: "2026-08", revenueExcludingVat: "200.00", invoicedIncludingVat: "242.00", invoiceCount: 1, correctionCount: 1 },
    { month: "2026-09", ...zero },
  ],
  totals: { revenueExcludingVat: "400.00", invoicedIncludingVat: "484.00", invoiceCount: 2, correctionCount: 1 },
}
const item = {
  id: "inv/2", series: "REP", number: 2, issueDate: "2026-07-10", dueDate: null, customerName: "Client SRL",
  totalIncludingVat: "242.00", paidAmount: "0.00", remainingAmount: "242.00", status: "overdue" as const,
}
const collections: CollectionsReport = {
  from: "2026-07-01", to: "2026-09-30", currency: "RON", status: "all",
  months: [{ month: "2026-07", collected: "50.00" }, { month: "2026-09", collected: "-172.00" }],
  collected: "-122.00",
  invoices: {
    count: 56, totalIncludingVat: "677.60", paidAmount: "0.00", remainingAmount: "677.60", overdueCount: 1, overdueAmount: "12.10",
    items: Array.from({ length: 50 }, () => item),
  },
}

void test("without the payments plugin the period has two cards and a single series", () => {
  const view = periodView(revenue, undefined)
  assert.deepEqual(view.cards.map((card) => card.key), ["revenue", "invoiced"])
  assert.deepEqual(view.cards.map((card) => card.value), ["400.00 RON", "484.00 RON"])
  assert.equal(view.cards[0]?.hint, "2 facturi, 1 storno")
  assert.equal(view.months.every((month) => month.collected === undefined), true)
  assert.deepEqual(revenueChartModel(view.months, "RON").series.map((series) => series.key), ["invoiced"])
  assert.match(chartDescription(view.months), /^Grafic pe luni: Facturat cu TVA, iul\. 2026 – sept\. 2026\./u)
})

void test("with collections the chart pairs each month, a missing month as zero, a negative one kept", () => {
  const view = periodView(revenue, { report: collections, failed: false })
  assert.equal(view.cards[2]?.value, "-122.00 RON")
  assert.deepEqual(view.months.map((month) => month.collected), ["50.00", "0.00", "-172.00"])
  const chart = revenueChartModel(view.months, "RON")
  assert.deepEqual(chart.series.map((series) => series.key), ["invoiced", "collected"])
  const september = chart.groups[2]?.bars[1]
  assert.ok(september)
  assert.equal(september.title, "Încasat, sept. 2026: -172.00 RON")
  // The negative bar starts on the zero line and goes down.
  assert.ok(Math.abs(september.y - chart.zeroY) < 1e-9 && september.height > 0)
  assert.deepEqual(chart.groups.map((group) => group.yearLabel), ["2026", undefined, undefined])
})

void test("collections for another period, still loading or failed, never reach the chart", () => {
  const stale = periodView(revenue, { report: { ...collections, from: "2026-06-01" }, failed: false })
  assert.equal(stale.cards[2]?.value, "Se încarcă…")
  assert.equal(stale.months.every((month) => month.collected === undefined), true)
  assert.equal(periodView(revenue, { report: undefined, failed: true }).cards[2]?.value, "Indisponibil")
})

void test("the invoices block: totals of the whole set, the list cut at 50 and said so", () => {
  const view = situationView(collections)
  assert.deepEqual(view.cards.map((card) => card.value), ["56", "677.60 RON", "0.00 RON", "677.60 RON", "12.10 RON"])
  assert.equal(view.cards[4]?.hint, "1 factură scadentă")
  assert.equal(view.count, "primele 50 din 56")
  assert.deepEqual(view.rows[0], {
    id: "inv/2", href: "/invoices/inv%2F2", number: "REP 2", customerName: "Client SRL", issueDate: "2026-07-10", dueDate: "—",
    total: "242.00 RON", paid: "0.00 RON", remaining: "242.00 RON", statusLabel: "Scadentă", statusTone: "muted",
  })
  assert.equal(listCount({ ...collections.invoices, count: 2, items: [item, item] }), "2 facturi")
})

void test("Romanian counting and month names", () => {
  assert.deepEqual([0, 1, 2, 19, 20, 100, 101, 120].map((count) => counted(count, "factură", "facturi")), [
    "0 facturi", "1 factură", "2 facturi", "19 facturi", "20 de facturi", "100 de facturi", "101 facturi", "120 de facturi",
  ])
  assert.equal(monthLabel("2026-01"), "ian. 2026")
  assert.equal(monthLabel("2026-12"), "dec. 2026")
})

void test("the period caption names collections only when the payments plugin runs", () => {
  const range = { from: "2026-01-01", to: "2026-03-31" }
  assert.equal(periodCaption(range, true), "2026-01-01 – 2026-03-31. Facturile și storno-urile după data emiterii, încasările după data plății.")
  assert.equal(periodCaption(range, false), "2026-01-01 – 2026-03-31. Facturile și storno-urile după data emiterii.")
})
