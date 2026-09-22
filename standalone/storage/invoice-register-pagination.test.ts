import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import { createInvoicingService, invoicingPermissions } from "../../cube/invoicing/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

const each = { code: "C62", name: "unitate" } as const
let key = 0
const idem = <T>(request: T) => ({ request, idempotency: { key: `register-${String(++key)}`, fingerprint: `sha256:${"0".repeat(64)}` } })

void test("mixed invoice register keyset pagination is stable for size 1/2, ties, source and organization", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-register-page-"))
  try {
    applyMigrations(directory)
    const permissions = invoicingPermissions("invoicing")
    let id = 0
    const serviceFor = (organizationId: string) => createInvoicingService({
      context: { current: Effect.succeed({ identity: { id: "u", username: "u", roles: ["admin"], permissions: Object.values(permissions) }, organization: { id: organizationId } }) },
      clock: { now: Effect.succeed(new Date("2026-09-05T10:00:00.000Z")) }, ids: { next: Effect.sync(() => `id-${String(++id).padStart(3, "0")}`) },
      store: createSqliteStore(directory), branding: { normalize: () => Effect.die("not expected") }, cubeIdentity: "invoicing",
    })
    const service = serviceFor("org-1")
    await Effect.runPromise(service.configureIssuer({ name: "Exemplu SRL", fiscalIdentifier: "12345674",
      address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT" }, legalForm: "srl",
      tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "1000.00",
      defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null }))
    await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "REG" }))
    const customer = { partyType: "company" as const, name: "Client SRL", fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } }
    const issue = (issueDate: string, sourceId: string) => Effect.runPromise(service.issueInvoice(idem({ customer,
      source: { app: "crm", kind: "order", id: sourceId }, series: "REG", issueDate, dueDate: "2026-09-20", currency: "RON" as const,
      lines: [{ description: "Servicii", quantity: "1", unitPrice: "10", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }] })))
    const first = await issue("2026-09-03", "shared")
    const second = await issue("2026-09-05", "other")
    const correction = await Effect.runPromise(service.createCorrection(idem({ originalInvoiceId: second.id,
      reason: "Storno", issueDate: "2026-09-05", source: { app: "crm", kind: "order", id: "shared" } })))
    const third = await issue("2026-09-05", "shared")
    const database = new DatabaseSync(databasePath(directory))
    const columns = (database.prepare("PRAGMA table_info(correction_documents)").all() as unknown as ReadonlyArray<{ name: string }>).map(({ name }) => name)
    const cloneCorrection = (newId: string, organizationId: string, originalInvoiceId: string, number: number, issueDate: string) => {
      const replacements: Readonly<Record<string, string | number>> = { id: newId, organization_id: organizationId, original_invoice_id: originalInvoiceId, number, issue_date: issueDate }
      const selected = columns.map((column) => Object.hasOwn(replacements, column) ? "?" : column).join(",")
      const values = columns.filter((column) => Object.hasOwn(replacements, column)).map((column) => replacements[column] as string | number)
      database.prepare(`INSERT INTO correction_documents (${columns.join(",")}) SELECT ${selected} FROM correction_documents WHERE id=?`)
        .run(...values, correction.id)
    }
    cloneCorrection(third.id, "org-1", second.id, third.number, third.issueDate)
    cloneCorrection("cross-org-correction", "org-2", first.id, 99, "2026-09-05")
    database.close()
    const expected = [`correction:${third.id}`, `invoice:${third.id}`, `correction:${correction.id}`, `invoice:${second.id}`, `invoice:${first.id}`]
    for (const limit of [1, 2]) {
      const seen: Array<string> = []
      let cursor: string | undefined
      do {
        const page = await Effect.runPromise(service.listInvoiceRegister(undefined, { limit, ...(cursor === undefined ? {} : { cursor }) }))
        seen.push(...page.items.map((item) => `${item.kind}:${item.id}`)); cursor = page.nextCursor ?? undefined
      } while (cursor !== undefined)
      assert.deepEqual(seen, expected)
      assert.equal(new Set(seen).size, expected.length)
    }
    const filtered = await Effect.runPromise(service.listInvoiceRegister({ app: "crm", kind: "order", id: "shared" }, { limit: 10 }))
    assert.deepEqual(filtered.items.map((item) => `${item.kind}:${item.id}`),
      [`correction:${third.id}`, `invoice:${third.id}`, `correction:${correction.id}`, `invoice:${first.id}`])
    assert.deepEqual((await Effect.runPromise(serviceFor("org-2").listInvoiceRegister(undefined, { limit: 10 }))).items, [])
    const tieCursor = Buffer.from(JSON.stringify({ issueDate: "2026-09-05", number: correction.number,
      id: correction.id, kind: "correction" })).toString("base64url")
    await assert.doesNotReject(Effect.runPromise(service.listInvoiceRegister(undefined, { limit: 2, cursor: tieCursor })))
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
