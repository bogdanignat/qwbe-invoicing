import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { invoicingPermissions } from "../../cubes/invoicing/index.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { handleApiRequest } from "./api.test-support.ts"
import { reportsApi, seedOrganization } from "./reports-api.test-support.ts"

const zero = { revenueExcludingVat: "0.00", invoicedIncludingVat: "0.00", invoiceCount: 0, correctionCount: 0 }

void test("revenue report nets invoices and corrections by issue month on PostgreSQL", async () => {
  await withMigrated("revenue_report_api", async (fixture) => {
    const api = reportsApi(fixture)
    await seedOrganization(api)

    // The storno of June's invoice lands in August; June itself is outside the period.
    const quarter = await api.get("/api/reports/revenue?from=2026-07-01&to=2026-09-30")
    assert.deepEqual(quarter, { status: 200, body: {
      from: "2026-07-01", to: "2026-09-30", currency: "RON",
      months: [
        { month: "2026-07", revenueExcludingVat: "200.00", invoicedIncludingVat: "242.00", invoiceCount: 1, correctionCount: 0 },
        { month: "2026-08", revenueExcludingVat: "200.00", invoicedIncludingVat: "242.00", invoiceCount: 1, correctionCount: 1 },
        { month: "2026-09", revenueExcludingVat: "50.00", invoicedIncludingVat: "60.50", invoiceCount: 2, correctionCount: 0 },
      ],
      totals: { revenueExcludingVat: "450.00", invoicedIncludingVat: "544.50", invoiceCount: 4, correctionCount: 1 },
    } })

    // Both ends are inclusive, and a month with nothing in it is a zero, not a gap.
    const edges = await api.get("/api/reports/revenue?from=2026-08-20&to=2026-10-31")
    assert.deepEqual((edges.body as { months: unknown }).months, [
      { month: "2026-08", revenueExcludingVat: "-100.00", invoicedIncludingVat: "-121.00", invoiceCount: 0, correctionCount: 1 },
      { month: "2026-09", revenueExcludingVat: "50.00", invoicedIncludingVat: "60.50", invoiceCount: 2, correctionCount: 0 },
      { month: "2026-10", ...zero },
    ])
    const toEdge = await api.get("/api/reports/revenue?from=2026-06-01&to=2026-06-15")
    assert.deepEqual((toEdge.body as { totals: unknown }).totals,
      { revenueExcludingVat: "100.00", invoicedIncludingVat: "121.00", invoiceCount: 1, correctionCount: 0 })

    const other = await api.get("/api/reports/revenue?from=2026-07-01&to=2026-09-30", api.runtime("org-2"))
    assert.deepEqual((other.body as { totals: unknown }).totals, zero)

    for (const query of ["from=2026-07-01", "to=2026-07-01", "from=2026-02-30&to=2026-03-01", "from=2026-09-01&to=2026-08-31",
      "from=2024-01-01&to=2027-01-01", "from=2026-07-01&from=2026-08-01&to=2026-09-01", "from=20260701&to=2026-09-01"]) {
      const response = await api.get(`/api/reports/revenue?${query}`)
      assert.equal(response.status, 400, query)
      assert.equal((response.body as { error: string }).error, "ValidationFailure", query)
    }
    assert.equal((await api.get("/api/reports/revenue?from=2024-01-01&to=2026-12-31")).status, 200)
    // The report is invoicing's own: it answers with the payments plugin off.
    assert.equal((await api.get("/api/reports/revenue?from=2026-07-01&to=2026-09-30",
      api.runtime("org-1", { payments: false, efactura: false }))).status, 200)

    const url = "/api/reports/revenue?from=2026-07-01&to=2026-09-30"
    assert.equal((await handleApiRequest({ method: "GET", url, authorization: undefined, body: undefined }, api.runtime())).status, 401)
    const permissions = Object.values(invoicingPermissions("invoicing")).filter((permission) => permission !== "invoicing:read")
    const denied = { ...api.runtime(), authenticate: () => ({ current: Effect.succeed({
      identity: { id: "u", username: "u", roles: [], permissions: [...permissions, "payments:read"] }, organization: { id: "org-1" } }) }) }
    assert.equal((await api.get(url, denied)).status, 403)
  })
})
