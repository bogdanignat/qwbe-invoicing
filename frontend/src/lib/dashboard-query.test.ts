import assert from "node:assert/strict"
import test from "node:test"

import {
  DEFAULT_DASHBOARD_QUERY, dashboardHref, dashboardRange, parseDashboardQuery, serializeDashboardQuery, type DashboardQuery,
} from "./dashboard-query.ts"

const preset = (value: "month" | "3m" | "6m" | "12m" | "year", status: DashboardQuery["status"] = "all"): DashboardQuery =>
  ({ period: { kind: "preset", preset: value }, status })
const custom = (from: string, to: string, status: DashboardQuery["status"] = "all"): DashboardQuery =>
  ({ period: { kind: "custom", range: { from, to } }, status })

void test("no query string is the default view: the last 12 months, every invoice", () => {
  assert.deepEqual(parseDashboardQuery(""), DEFAULT_DASHBOARD_QUERY)
  assert.deepEqual(DEFAULT_DASHBOARD_QUERY, preset("12m"))
  assert.equal(serializeDashboardQuery(DEFAULT_DASHBOARD_QUERY), "")
  assert.equal(dashboardHref(DEFAULT_DASHBOARD_QUERY), "/")
})

void test("an unknown preset or status reads as the default, never as an error", () => {
  assert.deepEqual(parseDashboardQuery("preset=24m"), preset("12m"))
  assert.deepEqual(parseDashboardQuery("preset="), preset("12m"))
  assert.deepEqual(parseDashboardQuery("preset=6m&status=open"), preset("6m"))
  assert.deepEqual(parseDashboardQuery("status=PAID"), preset("12m"))
  assert.deepEqual(parseDashboardQuery("?preset=3m&status=overdue"), preset("3m", "overdue"))
})

void test("half an interval, or one the backend would refuse, falls back to the preset", () => {
  assert.deepEqual(parseDashboardQuery("from=2026-01-01"), preset("12m"))
  assert.deepEqual(parseDashboardQuery("to=2026-01-01&preset=month"), preset("month"))
  assert.deepEqual(parseDashboardQuery("from=2026-02-30&to=2026-03-31"), preset("12m"))
  assert.deepEqual(parseDashboardQuery("from=2026-05-01&to=2026-04-01"), preset("12m"))
  assert.deepEqual(parseDashboardQuery("from=2020-01-01&to=2026-01-01"), preset("12m"))
})

void test("a complete interval wins over a preset and keeps its status", () => {
  assert.deepEqual(parseDashboardQuery("preset=3m&from=2026-02-01&to=2026-04-30&status=unpaid"),
    custom("2026-02-01", "2026-04-30", "unpaid"))
})

void test("every view survives a refresh: serializing and parsing again is the identity", () => {
  const views = [
    preset("month"), preset("3m", "paid"), preset("6m", "unpaid"), preset("12m", "overdue"), preset("year"),
    custom("2025-11-01", "2026-10-19"), custom("2028-02-29", "2028-03-01", "overdue"),
  ]
  for (const view of views) assert.deepEqual(parseDashboardQuery(serializeDashboardQuery(view)), view)
  assert.equal(dashboardHref(custom("2026-01-01", "2026-03-31", "paid")), "/?from=2026-01-01&to=2026-03-31&status=paid")
  assert.equal(dashboardHref(preset("12m", "unpaid")), "/?status=unpaid")
})

void test("Back and Forward land on the view each history entry was pushed for", () => {
  const pushed = [preset("12m"), preset("3m"), preset("3m", "unpaid"), custom("2026-01-01", "2026-06-30", "unpaid")]
  const history = pushed.map(dashboardHref)
  assert.deepEqual(history, ["/", "/?preset=3m", "/?preset=3m&status=unpaid", "/?from=2026-01-01&to=2026-06-30&status=unpaid"])
  // Walking the stack backwards and forwards again: each address reads as exactly its own view.
  const walk = [3, 2, 1, 0, 1, 2, 3]
  for (const index of walk) {
    const address = new URL(history[index] ?? "/", "https://invoice.example")
    assert.deepEqual(parseDashboardQuery(address.search), pushed[index])
  }
})

void test("the reports are asked for the resolved dates", () => {
  assert.deepEqual(dashboardRange(preset("6m").period, "2026-10-19"), { from: "2026-05-01", to: "2026-10-19" })
  assert.deepEqual(dashboardRange(custom("2026-01-01", "2026-01-31").period, "2026-10-19"), { from: "2026-01-01", to: "2026-01-31" })
})
