import assert from "node:assert/strict"
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { createRequestAuthenticator } from "../auth/auth.ts"
import { allPlugins, type PluginSelection } from "../plugins.ts"
import type { TestFixture } from "../storage/postgres-rig.test-support.ts"
import { handleApiRequest, type ApiResponse } from "./api.test-support.ts"
import type { ApiRuntime } from "./api.ts"

const each = { code: "C62", name: "unitate" } as const
const customer = { partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
  address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } }
/** The reports' "today" and the date every reversal gets. */
export const reportsNow = new Date("2026-09-12T10:00:00.000Z")

/** The reports API over a migrated database, as the kernel token for one organization at a time. */
export const reportsApi = (fixture: TestFixture) => {
  const token = "q".repeat(64)
  const tokenFile = join(fixture.dataDirectory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  const runtime = (organizationId = "org-1", plugins: PluginSelection = allPlugins): ApiRuntime => ({
    authenticate: createRequestAuthenticator(fixture.config({ authTokenFile: tokenFile, organizationId, plugins })),
    pool: fixture.pool, dataDirectory: fixture.dataDirectory, now: () => reportsNow, plugins,
  })
  let keys = 0
  const call = (target: ApiRuntime, method: string, url: string, body?: unknown): Promise<ApiResponse> =>
    handleApiRequest({ method, url, authorization: `Bearer ${token}`, body, idempotencyKey: `report-${String(++keys)}` }, target)
  const created = async (target: ApiRuntime, url: string, body: unknown): Promise<string> => {
    const response = await call(target, "POST", url, body)
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const result = response.body as { readonly id?: string; readonly payment?: { readonly id: string } }
    return result.payment?.id ?? result.id ?? ""
  }
  return {
    runtime,
    get: (url: string, target = runtime()) => call(target, "GET", url),
    setUp: async (target: ApiRuntime) => {
      assert.equal((await call(target, "PUT", "/api/issuer", { name: "Exemplu SRL", fiscalIdentifier: "12345674",
        address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT" }, legalForm: "srl",
        tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "1000.00",
        defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null })).status, 200)
      assert.equal((await call(target, "POST", "/api/document-series", { documentType: "invoice", series: "REP" })).status, 200)
    },
    /** One line at 21% VAT: the total with VAT is `unitPrice` × 1.21. */
    issue: (target: ApiRuntime, issueDate: string, unitPrice: string, dueDate: string | null) => created(target, "/api/invoices", {
      customer, series: "REP", issueDate, dueDate, currency: "RON",
      lines: [{ description: "Servicii", quantity: "1", unitPrice, unitOfMeasure: each, vatRateCode: "RO_STANDARD" }],
    }),
    correct: (target: ApiRuntime, invoiceId: string, issueDate: string) =>
      created(target, `/api/invoices/${invoiceId}/corrections`, { reason: "Storno integral", issueDate }),
    pay: (target: ApiRuntime, invoiceId: string, amount: string, paymentDate: string) =>
      created(target, `/api/invoices/${invoiceId}/payments`, { amount, currency: "RON", paymentDate, method: "transfer" }),
    reverse: (target: ApiRuntime, invoiceId: string, paymentId: string) =>
      created(target, `/api/invoices/${invoiceId}/payments/${paymentId}/reversal`, {}),
  }
}
export type ReportsApi = ReturnType<typeof reportsApi>

/**
 * org-1's documents, spread over June-September 2026:
 * A 2026-06-15 121.00 (outside July-September), its storno on 2026-08-20, B 2026-07-10 242.00 due 07-25,
 * C 2026-08-05 363.00 due 12-31, D 2026-09-01 0.00 with no due date, E 2026-09-05 60.50 due 09-20.
 * Payments: A 50.00 on 07-05; B 242.00 on 08-10, reversed on 09-12; C 100.00 on 08-15 and 13.00 on 10-01; E 70.00 on 09-06.
 */
export const seedOrganization = async (api: ReportsApi) => {
  const target = api.runtime("org-1")
  await api.setUp(target)
  const a = await api.issue(target, "2026-06-15", "100.00", "2026-06-30")
  const b = await api.issue(target, "2026-07-10", "200.00", "2026-07-25")
  const c = await api.issue(target, "2026-08-05", "300.00", "2026-12-31")
  await api.correct(target, a, "2026-08-20")
  const d = await api.issue(target, "2026-09-01", "0.00", null)
  const e = await api.issue(target, "2026-09-05", "50.00", "2026-09-20")
  await api.pay(target, a, "50.00", "2026-07-05")
  await api.reverse(target, b, await api.pay(target, b, "242.00", "2026-08-10"))
  await api.pay(target, c, "100.00", "2026-08-15")
  await api.pay(target, c, "13.00", "2026-10-01")
  await api.pay(target, e, "70.00", "2026-09-06")
  return { a, b, c, d, e }
}
