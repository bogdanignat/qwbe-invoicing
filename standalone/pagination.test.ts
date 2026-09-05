import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService, invoicingPermissions, type IssuedInvoice } from "../cube/invoicing/index.ts"
import { applyMigrations } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

const permissions = invoicingPermissions("invoicing")
const each = { code: "C62", name: "unitate" } as const
let counter = 0
const idempotent = <Input>(request: Input) => ({ request, idempotency: { key: `page-${String(++counter)}`, fingerprint: `sha256:${"0".repeat(64)}` } })

void test("SQLite registries page with a keyset cursor in issue-date, number and id order", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-pagination-"))
  try {
    applyMigrations(directory)
    let next = 0
    const service = createInvoicingService({
      context: { current: Effect.succeed({ identity: { id: "u", username: "u", roles: ["admin"], permissions: Object.values(permissions) }, organization: { id: "org-1" } }) },
      clock: { now: Effect.succeed(new Date("2026-09-05T10:00:00.000Z")) },
      ids: { next: Effect.sync(() => `id-${String(++next).padStart(3, "0")}`) },
      store: createSqliteStore(directory),
      cubeIdentity: "invoicing",
    })
    await Effect.runPromise(service.configureIssuer({
      name: "Exemplu SRL", fiscalIdentifier: "RO12345674", address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
      defaultCurrency: "RON", defaultPaymentTermDays: 15, vatConfigurations: [{ code: "RO_STANDARD", rate: "21.00", effectiveFrom: "2025-08-01" }],
    }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "QWBE" }))
    const customer = { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "RO87654329", address: { countryCode: "RO", city: "Iași", street: "Strada 2" } }
    const issued: Array<IssuedInvoice> = []
    for (const issueDate of ["2026-09-01", "2026-09-03", "2026-09-03", "2026-09-02", "2026-09-03"]) {
      issued.push(await Effect.runPromise(service.issueInvoice(idempotent({
        customer, series: "QWBE", issueDate, currency: "RON" as const,
        lines: [{ description: "Servicii", quantity: "1", unitPrice: "10", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }],
      }))))
    }
    const expected = [...issued].sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number - a.number || a.id.localeCompare(b.id)).map((invoice) => invoice.id)
    const seen: Array<string> = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await Effect.runPromise(service.listIssuedInvoices(undefined, { limit: 2, ...(cursor === undefined ? {} : { cursor }) }))
      assert.ok(page.items.length <= 2)
      seen.push(...page.items.map((invoice) => invoice.id))
      cursor = page.nextCursor ?? undefined
      pages += 1
    } while (cursor !== undefined)
    assert.equal(pages, 3)
    assert.deepEqual(seen, expected)

    for (const name of ["Zeta", "alfa", "Beta"]) {
      await Effect.runPromise(service.createCustomer({ ...customer, name, fiscalIdentifier: "RO87654329" }))
    }
    const first = await Effect.runPromise(service.listCustomers({ limit: 2 }))
    assert.deepEqual(first.items.map((item) => item.name), ["alfa", "Beta"])
    const rest = await Effect.runPromise(service.listCustomers({ limit: 2, cursor: first.nextCursor ?? "" }))
    assert.deepEqual(rest.items.map((item) => item.name), ["Zeta"])
    assert.equal(rest.nextCursor, null)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
