import assert from "node:assert/strict"
import test from "node:test"

import { customRangeIssue, isSendableEnd, isSendableRange, presetDateRange, registerPeriodFrom } from "./register-period.ts"
import { RANGE_ORDER_ISSUE } from "./report-period.ts"

void test("the current week starts on Monday and ends today", () => {
  // 2026-10-26 is a Monday, 2026-11-01 a Sunday.
  assert.deepEqual(presetDateRange("week", "2026-10-26"), { from: "2026-10-26", to: "2026-10-26" })
  assert.deepEqual(presetDateRange("week", "2026-10-29"), { from: "2026-10-26", to: "2026-10-29" })
  assert.deepEqual(presetDateRange("week", "2026-11-01"), { from: "2026-10-26", to: "2026-11-01" })
  // A week that began in the previous month and year.
  assert.deepEqual(presetDateRange("week", "2027-01-01"), { from: "2026-12-28", to: "2027-01-01" })
})

void test("the current month, the last 3 months and the current year end today", () => {
  const today = "2026-10-26"
  assert.deepEqual(presetDateRange("month", today), { from: "2026-10-01", to: today })
  assert.deepEqual(presetDateRange("3m", today), { from: "2026-08-01", to: today })
  assert.deepEqual(presetDateRange("year", today), { from: "2026-01-01", to: today })
  assert.deepEqual(presetDateRange("3m", "2026-02-10"), { from: "2025-12-01", to: "2026-02-10" })
})

void test("last month is a whole month, December of last year in January, 29 days in a leap February", () => {
  assert.deepEqual(presetDateRange("last-month", "2026-10-26"), { from: "2026-09-01", to: "2026-09-30" })
  assert.deepEqual(presetDateRange("last-month", "2026-01-15"), { from: "2025-12-01", to: "2025-12-31" })
  assert.deepEqual(presetDateRange("last-month", "2024-03-31"), { from: "2024-02-01", to: "2024-02-29" })
  assert.deepEqual(presetDateRange("last-month", "2026-03-01"), { from: "2026-02-01", to: "2026-02-28" })
})

void test("last year is the whole previous calendar year and everything is unbounded", () => {
  assert.deepEqual(presetDateRange("last-year", "2026-01-01"), { from: "2025-01-01", to: "2025-12-31" })
  assert.deepEqual(presetDateRange("all", "2026-10-26"), { from: "", to: "" })
})

void test("a custom interval may leave an end open but not run backwards", () => {
  assert.equal(customRangeIssue({ from: "", to: "" }), undefined)
  assert.equal(customRangeIssue({ from: "2026-09-01", to: "" }), undefined)
  assert.equal(customRangeIssue({ from: "2026-09-01", to: "2026-09-01" }), undefined)
  assert.equal(customRangeIssue({ from: "2026-09-02", to: "2026-09-01" }), RANGE_ORDER_ISSUE)
  // A year still being typed is not explained as an order problem.
  assert.equal(customRangeIssue({ from: "2026-09-02", to: "0202-09-01" }), undefined)
})

// A date input reports each keystroke of the year as a date; only a whole, plausible date is sent.
void test("only whole dates from 2000 on, in order, are sendable; an open end is", () => {
  for (const value of ["", "2000-01-01", "2026-10-26", "2024-02-29"]) assert.equal(isSendableEnd(value), true, value)
  for (const value of ["0001-11-02", "0002-11-02", "0020-11-02", "0202-11-02", "1999-12-31", "2025-02-29", "2026-1", "x"]) {
    assert.equal(isSendableEnd(value), false, value)
  }
  assert.equal(isSendableRange({ from: "2026-09-01", to: "2026-09-30" }), true)
  assert.equal(isSendableRange({ from: "", to: "2026-09-30" }), true)
  assert.equal(isSendableRange({ from: "2026-09-01", to: "0202-09-30" }), false)
  assert.equal(isSendableRange({ from: "2026-10-01", to: "2026-09-30" }), false)
})

void test("only a known period is read back from the select", () => {
  assert.equal(registerPeriodFrom("last-month"), "last-month")
  assert.equal(registerPeriodFrom("custom"), "custom")
  assert.equal(registerPeriodFrom("decade"), undefined)
})
