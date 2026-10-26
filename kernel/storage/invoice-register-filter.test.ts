import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import {
  createInvoicingService, invoicingPermissions, type InvoiceRegisterFilter, type InvoicingService,
} from "../../cubes/invoicing/index.ts"
import { withMigrated } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

const each = { code: "C62", name: "unitate" } as const
let key = 0
const idem = <T>(request: T) => ({ request, idempotency: { key: `filter-${String(++key)}`, fingerprint: `sha256:${"0".repeat(64)}` } })

const serviceOn = (pool: Parameters<typeof createPostgresStore>[0]): InvoicingService => {
  const permissions = invoicingPermissions("invoicing")
  let id = 0
  return createInvoicingService({
    context: { current: Effect.succeed({ identity: { id: "u", username: "u", roles: ["admin"], permissions: Object.values(permissions) }, organization: { id: "org-1" } }) },
    clock: { now: Effect.succeed(new Date("2026-10-05T10:00:00.000Z")) }, ids: { next: Effect.sync(() => `id-${String(++id).padStart(3, "0")}`) },
    store: createPostgresStore(pool), branding: { normalize: () => Effect.die("not expected") }, cubeIdentity: "invoicing",
  })
}

/**
 * Five invoices and one storno in series FCT, around September 2026:
 * FCT1 08-31 Alfa, FCT2 09-01 Ștefan, FCT3 09-15 "100% Bio", FCT4 09-30 "100 Bio",
 * FCT5 09-30 storno of FCT2 (Ștefan), FCT6 10-01 "A_B".
 */
const seed = async (service: InvoicingService) => {
  await Effect.runPromise(service.configureIssuer({ name: "Exemplu SRL", fiscalIdentifier: "12345674",
    address: { countryCode: "RO", city: "Botoșani", street: "Strada 1", county: "RO-BT" }, legalForm: "srl",
    tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca", socialCapital: "1000.00",
    defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange: { registered: true, effectiveFrom: "2025-08-01" }, branding: null }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "FCT" }))
  const issue = async (issueDate: string, name: string) => (await Effect.runPromise(service.issueInvoice(idem({
    customer: { partyType: "company" as const, name, fiscalIdentifier: "87654329", vatRegistered: true,
      address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } },
    series: "FCT", issueDate, dueDate: "2026-10-31", currency: "RON" as const,
    lines: [{ description: "Servicii", quantity: "1", unitPrice: "10", unitOfMeasure: each, vatRateCode: "RO_STANDARD" }] })))).id
  const fct1 = await issue("2026-08-31", "Alfa SRL")
  const fct2 = await issue("2026-09-01", "Ștefan Impex SRL")
  const fct3 = await issue("2026-09-15", "100% Bio SRL")
  const fct4 = await issue("2026-09-30", "100 Bio SRL")
  const fct5 = (await Effect.runPromise(service.createCorrection(idem({
    originalInvoiceId: fct2, reason: "Storno", issueDate: "2026-09-30" })))).id
  const fct6 = await issue("2026-10-01", "A_B SRL")
  return { fct1: `invoice:${fct1}`, fct2: `invoice:${fct2}`, fct3: `invoice:${fct3}`, fct4: `invoice:${fct4}`,
    fct5: `correction:${fct5}`, fct6: `invoice:${fct6}` }
}

/** Every page of the filtered register, following the cursor. */
const walk = async (service: InvoicingService, filter: InvoiceRegisterFilter, limit = 100): Promise<ReadonlyArray<string>> => {
  const seen: Array<string> = []
  let cursor: string | undefined
  do {
    const page = await Effect.runPromise(service.listInvoiceRegister(undefined, { limit, ...(cursor === undefined ? {} : { cursor }) }, filter))
    seen.push(...page.items.map((item) => `${item.kind}:${item.id}`))
    cursor = page.nextCursor ?? undefined
  } while (cursor !== undefined)
  return seen
}

void test("the register filters on PostgreSQL: inclusive dates, kind, search, escaped wildcards and the cursor inside the filter", async () => {
  await withMigrated("register_filter", async ({ pool }) => {
    const service = serviceOn(pool)
    const d = await seed(service)
    const everything = [d.fct6, d.fct5, d.fct4, d.fct3, d.fct2, d.fct1]

    // No filter is today's register, and so is a blank search.
    assert.deepEqual(await walk(service, {}), everything)
    assert.deepEqual((await Effect.runPromise(service.listInvoiceRegister())).items.map((item) => `${item.kind}:${item.id}`), everything)
    assert.deepEqual(await walk(service, { search: "   " }), everything)

    // Both ends of the interval are included, the days around them are not.
    const september = [d.fct5, d.fct4, d.fct3, d.fct2]
    assert.deepEqual(await walk(service, { from: "2026-09-01", to: "2026-09-30" }), september)
    assert.deepEqual(await walk(service, { from: "2026-09-30" }), [d.fct6, d.fct5, d.fct4])
    assert.deepEqual(await walk(service, { to: "2026-09-01" }), [d.fct2, d.fct1])
    assert.deepEqual(await walk(service, { from: "2026-09-15", to: "2026-09-15" }), [d.fct3])
    assert.deepEqual(await walk(service, { from: "2026-11-01" }), [])

    // The cursor pages inside the filter: every page size walks the same rows, once each.
    for (const limit of [1, 2, 3]) {
      assert.deepEqual(await walk(service, { from: "2026-09-01", to: "2026-09-30" }, limit), september, `limit ${String(limit)}`)
      assert.deepEqual(await walk(service, { kind: "invoice", search: "bio" }, limit), [d.fct4, d.fct3], `limit ${String(limit)}`)
    }

    assert.deepEqual(await walk(service, { kind: "correction" }), [d.fct5])
    assert.deepEqual(await walk(service, { kind: "invoice" }), [d.fct6, d.fct4, d.fct3, d.fct2, d.fct1])
    assert.deepEqual(await walk(service, { kind: "invoice", from: "2026-09-30", to: "2026-09-30" }), [d.fct4])

    // Series + number with or without the space, in any case; the customer name with diacritics folded.
    for (const search of ["FCT 3", "fct3", "Fct 3", "3", " FCT3 "]) assert.deepEqual(await walk(service, { search }), [d.fct3], search)
    for (const search of ["ștefan", "ȘTEFAN", "impex"]) assert.deepEqual(await walk(service, { search }), [d.fct5, d.fct2], search)

    // LIKE wildcards are searched for, not expanded.
    assert.deepEqual(await walk(service, { search: "%" }), [d.fct3])
    assert.deepEqual(await walk(service, { search: "100%" }), [d.fct3])
    assert.deepEqual(await walk(service, { search: "_" }), [d.fct6])
    assert.deepEqual(await walk(service, { search: "a_b" }), [d.fct6])
    assert.deepEqual(await walk(service, { search: "\\" }), [])
    assert.deepEqual(await walk(service, { search: "nimeni" }), [])
  })
})

void test("the register refuses a filter it cannot run, before reading anything", async () => {
  await withMigrated("register_filter_refusals", async ({ pool }) => {
    const service = serviceOn(pool)
    const refused = async (filter: InvoiceRegisterFilter) => {
      const failure = await Effect.runPromise(Effect.flip(service.listInvoiceRegister(undefined, undefined, filter)))
      assert.equal(failure._tag, "ValidationFailure", JSON.stringify(filter))
      return "issues" in failure ? failure.issues : []
    }
    assert.deepEqual(await refused({ from: "2026-09-30", to: "2026-09-01" }), ["from must not be after to"])
    assert.deepEqual(await refused({ from: "2026-02-30", to: "2026-9-1" }), [
      "from must be a calendar date in YYYY-MM-DD format", "to must be a calendar date in YYYY-MM-DD format"])
    assert.deepEqual(await refused({ kind: "legacy" as "invoice" }), ["kind must be invoice or correction"])
    assert.deepEqual(await refused({ search: "x".repeat(101) }), ["q must be at most 100 characters"])
    assert.deepEqual(await refused({ search: "a\u0000b" }), ["q must not contain control characters"])
    const longest = await Effect.runPromise(service.listInvoiceRegister(undefined, undefined, { search: "x".repeat(100) }))
    assert.deepEqual(longest.items, [])
  })
})
