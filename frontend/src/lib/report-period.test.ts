import assert from "node:assert/strict"
import test from "node:test"

import { isCalendarDate, presetRange, rangeIssue, rangeMonthCount } from "./report-period.ts"

void test("every preset ends today and the last N months include the current one", () => {
  const today = "2026-10-19"
  assert.deepEqual(presetRange("month", today), { from: "2026-10-01", to: today })
  assert.deepEqual(presetRange("3m", today), { from: "2026-08-01", to: today })
  assert.deepEqual(presetRange("6m", today), { from: "2026-05-01", to: today })
  assert.deepEqual(presetRange("12m", today), { from: "2025-11-01", to: today })
  assert.deepEqual(presetRange("year", today), { from: "2026-01-01", to: today })
  assert.equal(rangeMonthCount(presetRange("12m", today)), 12)
})

void test("a preset crosses the year end, and the current year in January is one month", () => {
  assert.deepEqual(presetRange("3m", "2026-01-15"), { from: "2025-11-01", to: "2026-01-15" })
  assert.deepEqual(presetRange("12m", "2026-01-31"), { from: "2025-02-01", to: "2026-01-31" })
  assert.deepEqual(presetRange("year", "2026-01-01"), { from: "2026-01-01", to: "2026-01-01" })
  assert.deepEqual(presetRange("year", "2026-12-31"), { from: "2026-01-01", to: "2026-12-31" })
})

void test("calendar dates: leap days only in leap years, nothing but YYYY-MM-DD", () => {
  assert.equal(isCalendarDate("2028-02-29"), true)
  assert.equal(isCalendarDate("2027-02-29"), false)
  assert.equal(isCalendarDate("2026-13-01"), false)
  assert.equal(isCalendarDate("2026-1-01"), false)
  assert.equal(isCalendarDate(""), false)
})

void test("a custom interval is refused for the same reasons the backend refuses it", () => {
  assert.equal(rangeIssue({ from: "2026-01-01", to: "2026-10-19" }), undefined)
  assert.equal(rangeIssue({ from: "2026-10-19", to: "2026-10-19" }), undefined)
  assert.match(rangeIssue({ from: "2026-01-01", to: "" }) ?? "", /ambele/u)
  assert.match(rangeIssue({ from: "", to: "2026-01-01" }) ?? "", /ambele/u)
  assert.match(rangeIssue({ from: "2026-02-30", to: "2026-03-01" }) ?? "", /valide/u)
  assert.match(rangeIssue({ from: "2026-10-20", to: "2026-10-19" }) ?? "", /după/u)
})

void test("at most 36 calendar months, counted by the months touched, not by days", () => {
  assert.equal(rangeIssue({ from: "2024-01-01", to: "2026-12-31" }), undefined)
  assert.equal(rangeIssue({ from: "2024-01-31", to: "2026-12-01" }), undefined)
  assert.match(rangeIssue({ from: "2023-12-31", to: "2026-12-31" }) ?? "", /36/u)
  assert.match(rangeIssue({ from: "2024-01-01", to: "2027-01-01" }) ?? "", /36/u)
  // A leap day at either end is an ordinary day of its month.
  assert.equal(rangeIssue({ from: "2025-03-01", to: "2028-02-29" }), undefined)
})
