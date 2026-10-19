import assert from "node:assert/strict"
import test from "node:test"

import { dashboardHref, parseDashboardQuery } from "./dashboard-query.ts"
import { parseSearch, stringifySearch } from "./search-params.ts"

const roundTrip = (search: string): string => stringifySearch(parseSearch(search))

void test("every dashboard address survives the router unchanged", () => {
  for (const href of [
    "/",
    dashboardHref({ period: { kind: "preset", preset: "12m" }, status: "overdue" }),
    dashboardHref({ period: { kind: "custom", range: { from: "2026-01-01", to: "2026-03-31" } }, status: "paid" }),
  ]) {
    const search = href.slice(1)
    assert.equal(roundTrip(search), search)
  }
})

void test("values stay text: nothing is JSON-decoded or quoted", () => {
  assert.deepEqual(parseSearch("?preset=6m&from=2026-01-01&n=12&flag=true&empty="),
    { preset: "6m", from: "2026-01-01", n: "12", flag: "true", empty: "" })
  assert.equal(roundTrip("?n=12&flag=true&list=%5B1%5D"), "?n=12&flag=true&list=%5B1%5D")
})

void test("a repeated key keeps its first value, as the dashboard reads it", () => {
  const search = "?status=paid&status=unpaid&preset=bogus"
  assert.deepEqual(parseSearch(search), { status: "paid", preset: "bogus" })
  assert.deepEqual(parseDashboardQuery(roundTrip(search)), parseDashboardQuery(search))
})

void test("an empty query writes nothing and values that are not text are left out", () => {
  assert.equal(stringifySearch({}), "")
  assert.equal(stringifySearch({ preset: "3m", page: 2, filter: { a: 1 }, gone: undefined }), "?preset=3m")
})
