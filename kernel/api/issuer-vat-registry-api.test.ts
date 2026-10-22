import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"
import type { Pool } from "pg"

import { invoicingPermissions } from "../../cubes/invoicing/index.ts"
import type { RequestAuthenticator } from "../auth/auth.ts"
import { ANAF_URL } from "../company-lookup/anaf-client.ts"
import { fakeTransport, json } from "../company-lookup/transport.test-support.ts"
import { allPlugins, type PluginSelection } from "../plugins.ts"
import { withMigrated } from "../storage/postgres-rig.test-support.ts"
import { createApiHandler } from "./api.ts"

/** `PUT /api/issuer` with ANAF's VAT registry behind a fake transport; "today" is 2026-09-01 in Bucharest. */

const today = "2026-09-01"
const authenticate: RequestAuthenticator = () => ({ current: Effect.succeed({
  identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: Object.values(invoicingPermissions("invoicing")) },
  organization: { id: "org-1" },
}) })
const issuer = (vatChange: Record<string, unknown>) => ({
  name: "Furnizor SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }, legalForm: "srl",
  tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca",
  socialCapital: "1000", defaultCurrency: "RON", defaultPaymentTermDays: 15, vatChange, branding: null,
})
const registeredFrom = (effectiveFrom: string) => issuer({ registered: true, effectiveFrom })
const nonVatFrom = (effectiveFrom: string) => issuer({ registered: false, effectiveFrom, nonVatBasis: "article_310" })
/** ANAF's answer about the CUI asked. */
type Anaf = (cui: number) => Response
const company = (scpTVA: boolean): Anaf => (cui) => json({ found: [{
  date_generale: { cui, denumire: "FURNIZOR SRL" }, inregistrare_scop_Tva: { scpTVA, perioade_TVA: [] },
}], notFound: [] })

/** One handler for the whole test, as the server holds one; `anaf` answers the registry and may be swapped. */
const rig = (pool: Pool, dataDirectory: string, plugins: PluginSelection = allPlugins) => {
  let anaf: Anaf = company(true)
  const fake = fakeTransport((sent) => sent.url === ANAF_URL
    ? anaf((JSON.parse(String(sent.body)) as ReadonlyArray<{ readonly cui: number }>)[0]?.cui ?? 0)
    : new Response(null, { status: 500 }))
  const handler = createApiHandler({ authenticate, pool, dataDirectory, plugins, transport: fake.transport,
    now: () => new Date(`${today}T10:00:00.000Z`) })
  const call = async (method: string, path: string, body?: unknown, key?: string) => {
    const response = await handler.handle(new Request(`http://qwbe.local/api${path}`, { method,
      headers: { "content-type": "application/json", authorization: "Bearer x", ...(key === undefined ? {} : { "idempotency-key": key }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  const asked = () => fake.sent.filter(({ url }) => url === ANAF_URL).map(({ body }) => JSON.parse(String(body)) as unknown)
  return { call, asked, answer: (next: Anaf) => { anaf = next }, dispose: handler.dispose }
}

void test("a checked fiscal change answers warnings [], asks ANAF on both days and audits the check", async () => {
  await withMigrated("issuer_registry_ok", async ({ pool, dataDirectory, sql }) => {
    const api = rig(pool, dataDirectory)
    try {
      const saved = await api.call("PUT", "/issuer", registeredFrom("2025-08-01"))
      assert.equal(saved.status, 200, JSON.stringify(saved.body))
      assert.deepEqual(saved.body.warnings, [])
      assert.deepEqual(api.asked(), [[{ cui: 12345674, data: "2025-08-01" }], [{ cui: 12345674, data: today }]])
      assert.equal(Object.hasOwn((await api.call("GET", "/issuer")).body, "warnings"), false)
      assert.equal(await sql.scalar("SELECT reason FROM audit_events WHERE action = 'issuer.configured'"), "vat_registry:checked")
    } finally { await api.dispose() }
  })
})

void test("ANAF contradicting the regime is 400, ANAF down is 503, and a non-fiscal save works while it is down", async () => {
  await withMigrated("issuer_registry_refusals", async ({ pool, dataDirectory, sql }) => {
    const api = rig(pool, dataDirectory)
    try {
      assert.equal((await api.call("PUT", "/issuer", registeredFrom("2025-08-01"))).status, 200)
      const state = () => sql.query("SELECT to_jsonb(t) AS row FROM issuer_tax_configurations t ORDER BY to_jsonb(t)::text")
      const before = await state()
      const mismatch = await api.call("PUT", "/issuer", nonVatFrom("2026-01-01"))
      assert.equal(mismatch.status, 400)
      assert.equal(mismatch.body.error, "ValidationFailure")
      assert.match(String((mismatch.body.issues as ReadonlyArray<string>)[0]), /ANAF arată că CIF-ul 12345674 este înregistrat/u)
      api.answer((cui) => json({ found: [], notFound: [cui] }, 404))
      assert.match(JSON.stringify((await api.call("PUT", "/issuer", nonVatFrom("2026-01-01"))).body), /nu figurează în registrul ANAF/u)
      api.answer(() => json({ error: "down" }, 500))
      assert.deepEqual(await api.call("PUT", "/issuer", nonVatFrom("2026-01-01")), { status: 503, body: { error: "vat_registry_unavailable" } })
      assert.deepEqual(await state(), before)
      const asked = api.asked().length
      const renamed = await api.call("PUT", "/issuer", { ...registeredFrom("2025-08-01"), name: "Alt nume SRL" })
      assert.deepEqual([renamed.status, renamed.body.name, renamed.body.warnings], [200, "Alt nume SRL", []])
      assert.equal(api.asked().length, asked, "a save that changes nothing fiscal never asks ANAF")
    } finally { await api.dispose() }
  })
})

void test("an issued invoice in the period the change rewrites is 409 with its code", async () => {
  await withMigrated("issuer_registry_documents", async ({ pool, dataDirectory }) => {
    const api = rig(pool, dataDirectory)
    try {
      assert.equal((await api.call("PUT", "/issuer", registeredFrom("2025-08-01"))).status, 200)
      assert.equal((await api.call("POST", "/document-series", { documentType: "invoice", series: "INV" })).status, 200)
      const issued = await api.call("POST", "/invoices", { series: "INV", issueDate: today, dueDate: "2026-09-30", currency: "RON",
        customer: { partyType: "individual", name: "Client", fiscalIdentifier: "", vatRegistered: false,
          address: { countryCode: "RO", city: "Iași", street: "Strada 2", county: "RO-IS" } },
        lines: [{ description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: { code: "C62", name: "unitate" }, vatRateCode: "RO_STANDARD" }],
      }, "registry-invoice")
      assert.equal(issued.status, 200, JSON.stringify(issued.body))
      api.answer(company(false))
      assert.deepEqual(await api.call("PUT", "/issuer", nonVatFrom(today)),
        { status: 409, body: { error: "DomainConflict", code: "vat_change_affects_issued_documents" } })
      api.answer(company(true))
      assert.deepEqual(await api.call("PUT", "/issuer", { ...registeredFrom("2025-08-01"), fiscalIdentifier: "87654329" }),
        { status: 409, body: { error: "DomainConflict", code: "fiscal_identifier_change_has_issued_documents" } })
    } finally { await api.dispose() }
  })
})

void test("with company-lookup off a fiscal change is saved unchecked, says so in warnings and the audit", async () => {
  await withMigrated("issuer_registry_off", async ({ pool, dataDirectory, sql }) => {
    const api = rig(pool, dataDirectory, { ...allPlugins, "company-lookup": false })
    try {
      const saved = await api.call("PUT", "/issuer", registeredFrom("2025-08-01"))
      assert.deepEqual([saved.status, saved.body.warnings], [200, ["vat_registry_not_checked"]])
      assert.deepEqual(api.asked(), [])
      assert.equal(await sql.scalar("SELECT reason FROM audit_events WHERE action = 'issuer.configured'"), "vat_registry:not_checked")
    } finally { await api.dispose() }
  })
})
