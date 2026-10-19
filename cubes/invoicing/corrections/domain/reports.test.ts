import assert from "node:assert/strict"
import test from "node:test"

import { maximumReportMonths, reportMonths, reportPeriodIssues, revenueReport } from "./reports.ts"

void test("a period is two calendar dates, in order, inclusive and at most 36 calendar months", () => {
  assert.deepEqual(reportPeriodIssues({ from: "2026-09-10", to: "2026-09-10" }), [])
  assert.deepEqual(reportPeriodIssues({ from: "2024-01-31", to: "2026-12-01" }), [])
  assert.deepEqual(reportPeriodIssues({ from: "2024-01-01", to: "2027-01-01" }),
    [`the period must span at most ${String(maximumReportMonths)} calendar months`])
  assert.deepEqual(reportPeriodIssues({ from: "2026-09-11", to: "2026-09-10" }), ["from must not be after to"])
  assert.deepEqual(reportPeriodIssues({ from: "2024-02-29", to: "2024-03-01" }), [])
  assert.deepEqual(reportPeriodIssues({ from: "2025-02-29", to: "2026-13-01" }), [
    "from must be a calendar date in YYYY-MM-DD format", "to must be a calendar date in YYYY-MM-DD format",
  ])
  for (const value of ["", "2026-9-01", "2026-09-01T00:00:00Z", " 2026-09-01", "0099-01-01"]) {
    assert.equal(reportPeriodIssues({ from: value, to: "2026-09-30" }).length, 1, value)
  }
})

void test("the months of a period run continuously across a year end", () => {
  assert.deepEqual(reportMonths({ from: "2025-11-30", to: "2026-02-01" }), ["2025-11", "2025-12", "2026-01", "2026-02"])
  assert.equal(reportMonths({ from: "2024-01-01", to: "2026-12-31" }).length, maximumReportMonths)
})

void test("the revenue report lists every month, empty ones as zero, and keeps the store's totals", () => {
  const totals = { revenueExcludingVat: "-50.00", invoicedIncludingVat: "-60.50", invoiceCount: 1, correctionCount: 2 }
  const march = { month: "2026-03", ...totals }
  assert.deepEqual(revenueReport({ from: "2026-02-15", to: "2026-04-01" }, { months: [march], totals }), {
    from: "2026-02-15", to: "2026-04-01", currency: "RON", totals,
    months: [
      { month: "2026-02", revenueExcludingVat: "0.00", invoicedIncludingVat: "0.00", invoiceCount: 0, correctionCount: 0 },
      march,
      { month: "2026-04", revenueExcludingVat: "0.00", invoicedIncludingVat: "0.00", invoiceCount: 0, correctionCount: 0 },
    ],
  })
})
