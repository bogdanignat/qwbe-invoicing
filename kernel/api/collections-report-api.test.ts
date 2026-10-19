import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { handleApiRequest } from "./api.test-support.ts"
import { reportsApi, seedOrganization } from "./reports-api.test-support.ts"

interface Situation {
  readonly count: number
  readonly overdueCount: number
  readonly items: ReadonlyArray<{ readonly id: string; readonly status: string; readonly paidAmount: string; readonly remainingAmount: string }>
}
interface Report { readonly months: unknown; readonly collected: string; readonly invoices: Situation }
const quarter = "/api/reports/collections?from=2026-07-01&to=2026-09-30"

void test("collections report: payments by payment date, invoices of the period with today's balance", async () => {
  await withMigrated("collections_report_api", async (fixture) => {
    const api = reportsApi(fixture)
    const { b, c, d, e } = await seedOrganization(api)

    // A's July payment counts although A was issued in June; B's reversal makes September negative;
    // C's October payment is outside the period but inside C's balance.
    const all = await api.get(quarter)
    assert.equal(all.status, 200)
    const { invoices, ...period } = all.body as Report & Readonly<Record<string, unknown>>
    assert.deepEqual(period, { from: "2026-07-01", to: "2026-09-30", currency: "RON", status: "all",
      months: [{ month: "2026-07", collected: "50.00" }, { month: "2026-08", collected: "342.00" }, { month: "2026-09", collected: "-172.00" }],
      collected: "220.00" })
    assert.deepEqual(invoices, {
      count: 4, totalIncludingVat: "665.50", paidAmount: "183.00", remainingAmount: "492.00", overdueCount: 1, overdueAmount: "242.00",
      items: [
        { id: b, series: "REP", number: 2, issueDate: "2026-07-10", dueDate: "2026-07-25", customer: { name: "Client SRL" },
          totalIncludingVat: "242.00", paidAmount: "0.00", remainingAmount: "242.00", status: "overdue" },
        { id: e, series: "REP", number: 6, issueDate: "2026-09-05", dueDate: "2026-09-20", customer: { name: "Client SRL" },
          totalIncludingVat: "60.50", paidAmount: "70.00", remainingAmount: "0.00", status: "overpaid" },
        { id: c, series: "REP", number: 3, issueDate: "2026-08-05", dueDate: "2026-12-31", customer: { name: "Client SRL" },
          totalIncludingVat: "363.00", paidAmount: "113.00", remainingAmount: "250.00", status: "partially_paid" },
        { id: d, series: "REP", number: 5, issueDate: "2026-09-01", dueDate: null, customer: { name: "Client SRL" },
          totalIncludingVat: "0.00", paidAmount: "0.00", remainingAmount: "0.00", status: "unpaid" },
      ],
    })

    const filtered = async (status: string) => (await api.get(`${quarter}&status=${status}`)).body as Report
    const paid = await filtered("paid")
    assert.deepEqual([paid.invoices.items.map((item) => item.id), paid.collected, paid.months], [[e], "220.00", period.months])
    const unpaid = await filtered("unpaid")
    assert.deepEqual(unpaid.invoices.items.map((item) => item.id), [b, c, d])
    assert.deepEqual([unpaid.invoices.count, unpaid.invoices.overdueCount], [3, 1])
    assert.deepEqual((await filtered("overdue")).invoices.items.map((item) => item.id), [b])

    const other = (await api.get(quarter, api.runtime("org-2"))).body as Report
    assert.deepEqual([other.collected, other.invoices.count, other.invoices.items], ["0.00", 0, []])

    for (const query of ["from=2026-07-01", "from=2026-07-01&to=2026-09-30&status=open", "from=2026-09-01&to=2026-08-31",
      "from=2023-12-31&to=2026-12-31", "from=2026-07-01&to=2026-09-30&status=paid&status=unpaid"]) {
      const response = await api.get(`/api/reports/collections?${query}`)
      assert.equal(response.status, 400, query)
      assert.equal((response.body as { error: string }).error, "ValidationFailure", query)
    }
    assert.equal((await handleApiRequest({ method: "GET", url: quarter, authorization: undefined, body: undefined }, api.runtime())).status, 401)
    const as = (permissions: ReadonlyArray<string>) => ({ ...api.runtime(), authenticate: () => ({ current: Effect.succeed({
      identity: { id: "u", username: "u", roles: [], permissions }, organization: { id: "org-1" } }) }) })
    assert.equal((await api.get(quarter, as(["payments:payment.record", "invoicing:issue"]))).status, 403)
    assert.equal((await api.get(quarter, as(["invoicing:read"]))).status, 200)

    const off = await api.get(quarter, api.runtime("org-1", { payments: false, efactura: true }))
    assert.equal(off.status, 404)
  })
})

void test("collections report totals every matching invoice and lists the first 50 by due date, then id", async () => {
  await withMigrated("collections_report_limit", async (fixture) => {
    const api = reportsApi(fixture)
    const target = api.runtime("org-3")
    await api.setUp(target)
    const ids: Array<string> = []
    for (let index = 0; index < 55; index += 1) ids.push(await api.issue(target, "2026-09-01", "10.00", "2026-09-30"))
    const late = await api.issue(target, "2026-09-02", "10.00", "2026-09-10")

    const report = (await api.get("/api/reports/collections?from=2026-09-01&to=2026-09-30&status=unpaid", target)).body as Report
    assert.deepEqual([report.invoices.count, report.invoices.overdueCount, report.invoices.items.length], [56, 1, 50])
    const { items, ...totals } = report.invoices as Situation & Readonly<Record<string, unknown>>
    assert.deepEqual(totals, { count: 56, totalIncludingVat: "677.60", paidAmount: "0.00", remainingAmount: "677.60",
      overdueCount: 1, overdueAmount: "12.10" })
    assert.deepEqual(items.map((item) => item.id), [late, ...[...ids].sort().slice(0, 49)])
  })
})
