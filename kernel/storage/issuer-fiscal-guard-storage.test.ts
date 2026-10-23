import assert from "node:assert/strict"
import test from "node:test"

import { Effect, Either } from "effect"
import type { Pool } from "pg"

import { createInvoicingService, type InvoicingDependencies } from "../../cubes/invoicing/index.ts"
import { issuerSaveConflicts, type VatRegistry } from "../../cubes/invoicing/issuer/index.ts"
import { withMigrated } from "./postgres-rig.test-support.ts"
import { createPostgresStore } from "./postgres-store.ts"

/**
 * The issuer's fiscal guard on PostgreSQL 16: the issued-documents `EXISTS`, and
 * an issuance racing a regime change. Whichever order the two take, they cannot
 * both succeed: the guard runs under the business lock issuance takes too.
 */

const today = "2026-09-01"
let keys = 0
const request = <Input>(value: Input) => ({
  request: value, idempotency: { key: `fiscal-guard-${String(++keys)}`, fingerprint: `sha256:${"0".repeat(64)}` },
})
const issuer = {
  name: "Furnizor SRL", fiscalIdentifier: "12345674",
  address: { countryCode: "RO", city: "Iași", street: "Strada 1", county: "RO-IS" }, legalForm: "srl" as const,
  tradeRegistryNumber: "J22/123/2020", iban: "RO49AAAA1B31007593840000", bankName: "Banca",
  socialCapital: "1000.00", defaultCurrency: "RON", defaultPaymentTermDays: 15, branding: null,
}
const nonVatFrom = (effectiveFrom: string) => ({ ...issuer, vatChange: { registered: false, effectiveFrom, nonVatBasis: "article_310" } as const })
const invoice = (issueDate: string) => request({
  customer: { partyType: "individual" as const, name: "Client", fiscalIdentifier: "", vatRegistered: false, address: issuer.address },
  series: "INV", issueDate, dueDate: "2026-09-30", currency: "RON" as const,
  lines: [{ description: "Servicii", quantity: "1", unitPrice: "100", unitOfMeasure: { code: "C62", name: "unitate" }, vatRateCode: "RO_STANDARD" }],
})

const serviceFor = (pool: Pool, extra: Partial<Pick<InvoicingDependencies, "store" | "vatRegistry">> = {}) => {
  let nextId = 0
  return createInvoicingService({
    context: { current: Effect.succeed({
      identity: { id: "user-1", username: "owner", roles: ["admin"], permissions: [
        "invoicing:read", "invoicing:settings.manage", "invoicing:invoice.issue", "invoicing:invoice.void",
      ] },
      organization: { id: "org-1" },
    }) },
    clock: { now: Effect.succeed(new Date(`${today}T10:00:00.000Z`)) },
    ids: { next: Effect.sync(() => `guard-${String(++nextId)}-${String(keys)}`) },
    branding: { normalize: () => Effect.die("branding normalization is not expected") },
    store: createPostgresStore(pool), cubeIdentity: "invoicing", ...extra,
  })
}

const registeredIssuer = async (pool: Pool) => {
  const service = serviceFor(pool)
  await Effect.runPromise(service.configureIssuer({ ...issuer, vatChange: { registered: true, effectiveFrom: "2025-08-01" } }))
  await Effect.runPromise(service.addDocumentSeries({ documentType: "invoice", series: "INV" }))
  return service
}

/** A promise and the function that settles it, for holding one side of a race at a known point. */
const latch = () => {
  let open: () => void = () => undefined
  const opened = new Promise<void>((resolve) => { open = resolve })
  return { open, opened }
}
const notRegistered = (hold?: Promise<void>): VatRegistry => ({
  statusOn: () => Effect.promise(async () => { await hold }).pipe(Effect.as("not_registered" as const)),
})

void test("EXISTS sees the organization's invoices and stornos dated on or after the day, or ever", async () => {
  await withMigrated("fiscal_guard_exists", async ({ pool }) => {
    const service = await registeredIssuer(pool)
    const store = createPostgresStore(pool)
    const has = (organizationId: string, from?: string) =>
      Effect.runPromise(store.transaction((transaction) => transaction.hasIssuedDocuments(organizationId, from)))
    assert.equal(await has("org-1"), false)
    const issued = await Effect.runPromise(service.issueInvoice(invoice("2026-08-20")))
    assert.deepEqual(await Promise.all(["2026-08-19", "2026-08-20", "2026-08-21"].map((from) => has("org-1", from))), [true, true, false])
    await Effect.runPromise(service.createCorrection(request({ originalInvoiceId: issued.id, reason: "Storno" })))
    assert.deepEqual(await Promise.all(["2026-08-21", today, "2026-09-02"].map((from) => has("org-1", from))), [true, true, false],
      "the storno, dated today, counts on its own")
    assert.equal(await has("org-1"), true)
    assert.equal(await has("org-2"), false)
    assert.equal(await has("org-2", "2000-01-01"), false)
  })
})

void test("an invoice issued while ANAF is asked is seen by the final transaction: the regime change is refused", async () => {
  await withMigrated("fiscal_guard_race_issue", async ({ pool, sql }) => {
    const issuing = await registeredIssuer(pool)
    const asked = latch()
    const answer = latch()
    const changing = serviceFor(pool, { vatRegistry: { statusOn: (cif, date) => Effect.sync(asked.open).pipe(
      Effect.zipRight(notRegistered(answer.opened).statusOn(cif, date))) } })
    const change = Effect.runPromise(Effect.either(changing.configureIssuer(nonVatFrom(today))))
    await asked.opened
    await Effect.runPromise(issuing.issueInvoice(invoice(today)))
    answer.open()
    const refused = await change
    assert.ok(Either.isLeft(refused) && refused.left._tag === "DomainConflict")
    assert.equal(refused.left.code, issuerSaveConflicts.issuedDocuments)
    assert.equal(await sql.scalar("SELECT count(*)::int FROM issuer_tax_configurations WHERE code = 'RO_NON_VAT'"), 0)
  })
})

void test("an issuance that waits for the regime change's commit is judged under the new regime and refused", async () => {
  await withMigrated("fiscal_guard_race_change", async ({ pool, sql }) => {
    const issuing = await registeredIssuer(pool)
    const saving = latch()
    const commit = latch()
    const base = createPostgresStore(pool)
    const changing = serviceFor(pool, { vatRegistry: notRegistered(), store: {
      transaction: (use) => base.transaction((transaction) => use({ ...transaction,
        saveIssuer: (profile) => Effect.promise(async () => { saving.open(); await commit.opened }).pipe(
          Effect.zipRight(transaction.saveIssuer(profile))) })),
    } })
    const change = Effect.runPromise(changing.configureIssuer(nonVatFrom(today)))
    await saving.opened
    const issuance = Effect.runPromise(Effect.either(issuing.issueInvoice(invoice(today))))
    // The issuance is parked on the business lock the change holds, not finished before it.
    for (let tries = 0; ; tries += 1) {
      // In this database only: the cluster is shared with the application and other runs.
      if (await sql.scalar("SELECT count(*)::int FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"
        + " AND database = (SELECT oid FROM pg_database WHERE datname = current_database())") === 1) break
      assert.ok(tries < 100, "the issuance never waited on the business lock")
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    commit.open()
    assert.equal((await change).currentVat?.registered, false)
    const refused = await issuance
    assert.ok(Either.isLeft(refused) && refused.left._tag === "ValidationFailure", JSON.stringify(refused))
    assert.equal(await sql.scalar("SELECT count(*)::int FROM issued_invoices"), 0)
  })
})
