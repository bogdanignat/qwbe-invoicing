import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { Effect } from "effect"

import { invoicingPermissions } from "../../cube/invoicing/index.ts"
import { createRequestAuthenticator } from "../auth/auth.ts"
import { applyMigrations } from "../storage/migrations.ts"
import { handleApiRequest } from "./api.test-support.ts"

const each = { code: "C62", name: "unitate" } as const

void test("invoice register exposes invoices and corrections without changing /api/invoices", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-register-api-"))
  const token = "r".repeat(64)
  const tokenFile = join(directory, "api-token")
  writeFileSync(tokenFile, token, { mode: 0o600 })
  try {
    applyMigrations(directory)
    const makeRuntime = (organizationId: string) => ({
      authenticate: createRequestAuthenticator({ host: "127.0.0.1", port: 3000, dataDirectory: directory,
        nodeEnvironment: "test", authTokenFile: tokenFile, organizationId }),
      dataDirectory: directory, now: () => new Date("2026-09-05T10:00:00.000Z"),
    })
    const runtime = makeRuntime("org-1")
    const authorization = `Bearer ${token}`
    const call = (method: string, url: string, body?: unknown, idempotencyKey?: string, target = runtime) =>
      handleApiRequest({ method, url, authorization, body, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) }, target)
    await call("PUT", "/api/issuer", { name: "Exemplu SRL", fiscalIdentifier: "12345674",
      address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT" }, legalForm: "srl",
      tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "1000.00",
      defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null })
    await call("POST", "/api/document-series", { documentType: "invoice", series: "REG" })
    const customer = { partyType: "company", name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } }
    const invoice = await call("POST", "/api/invoices", { customer, source: { app: "crm", kind: "order", id: "o-1" },
      series: "REG", issueDate: "2026-09-04", dueDate: "2026-09-20", currency: "RON",
      lines: [{ description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }] }, "reg-invoice")
    assert.equal(invoice.status, 200)
    const invoiceId = (invoice.body as { id: string }).id
    const correction = await call("POST", `/api/invoices/${invoiceId}/corrections`, {
      reason: "Storno integral", issueDate: "2026-09-05", source: { app: "erp", kind: "return", id: "r-1" },
    }, "reg-correction")
    assert.equal(correction.status, 200)

    const register = await call("GET", "/api/invoice-register?limit=2")
    assert.equal(register.status, 200)
    const items = (register.body as { items: ReadonlyArray<Record<string, unknown>>; nextCursor: string | null }).items
    assert.equal(items.length, 2)
    assert.deepEqual(items[0], { kind: "correction", id: (correction.body as { id: string }).id, series: "REG", number: 2,
      issueDate: "2026-09-05", customer: { name: "Client SRL" }, currency: "RON", totalIncludingVat: "-121.00",
      dueDate: null, eFacturaStatus: null, originalReference: { id: invoiceId, series: "REG", number: 1 } })
    assert.deepEqual(items[1], { kind: "invoice", id: invoiceId, series: "REG", number: 1, issueDate: "2026-09-04",
      customer: { name: "Client SRL" }, currency: "RON", totalIncludingVat: "121.00", dueDate: "2026-09-20", eFacturaStatus: "not_sent" })
    assert.equal(Object.hasOwn(items[1] as object, "originalReference"), false)
    const oldInvoices = (await call("GET", "/api/invoices")).body as { items: ReadonlyArray<{ id: string }> }
    assert.deepEqual(oldInvoices.items.map((item) => item.id), [invoiceId])
    assert.equal(oldInvoices.items.some((item) => item.id === (correction.body as { id: string }).id), false)
    assert.deepEqual((await call("GET", "/api/invoice-register?sourceApp=erp&sourceKind=return&sourceId=r-1")).body,
      { items: [items[0]], nextCursor: null })
    assert.deepEqual((await call("GET", "/api/invoice-register", undefined, undefined, makeRuntime("org-2"))).body,
      { items: [], nextCursor: null })

    const zero = await call("POST", "/api/invoices", { customer, source: { app: "crm", kind: "order", id: "zero" },
      series: "REG", issueDate: "2026-09-05", dueDate: null, currency: "RON",
      lines: [{ description: "Gratuit", quantity: "1", unitPrice: "0", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }] }, "reg-zero")
    assert.equal(zero.status, 200)
    const zeroRegister = await call("GET", "/api/invoice-register?sourceApp=crm&sourceKind=order&sourceId=zero")
    assert.deepEqual((zeroRegister.body as { items: ReadonlyArray<{ dueDate: string | null; eFacturaStatus: string }> }).items
      .map(({ dueDate, eFacturaStatus }) => ({ dueDate, eFacturaStatus })), [{ dueDate: null, eFacturaStatus: "not_sent" }])

    const oldCursor = Buffer.from(JSON.stringify({ issueDate: "2026-09-05", number: 2, id: "x" })).toString("base64url")
    const badKind = Buffer.from(JSON.stringify({ issueDate: "2026-09-05", number: 2, id: "x", kind: "legacy" })).toString("base64url")
    for (const url of ["/api/invoice-register?limit=0", "/api/invoice-register?limit=201",
      "/api/invoice-register?cursor=%%%", `/api/invoice-register?cursor=${oldCursor}`, "/api/invoice-register?sourceApp=crm"]) {
      assert.equal((await call("GET", url)).status, 400, url)
    }
    assert.deepEqual(await call("GET", `/api/invoice-register?cursor=${badKind}`),
      { status: 400, body: { error: "ValidationFailure", issues: ["cursor is invalid"] } })
    assert.equal((await handleApiRequest({ method: "GET", url: "/api/invoice-register", authorization: undefined, body: undefined }, runtime)).status, 401)
    const perms = invoicingPermissions("invoicing")
    const deniedRuntime = { ...runtime, authenticate: () => ({ current: Effect.succeed({ identity: { id: "u", username: "u", roles: [],
      permissions: Object.values(perms).filter((permission) => permission !== perms.read) }, organization: { id: "org-1" } }) }) }
    assert.equal((await call("GET", "/api/invoice-register", undefined, undefined, deniedRuntime)).status, 403)
    for (const method of ["POST", "PUT", "DELETE"]) assert.equal((await call(method, "/api/invoice-register", {})).status, 405)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
