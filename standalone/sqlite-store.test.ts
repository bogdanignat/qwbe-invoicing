import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import {
  DomainConflict,
  ResourceNotFound,
  createInvoicingService,
  type Clock,
  type IdGenerator,
  type RequestContextProvider,
} from "../cube/invoicing/index.ts"
import { applyMigrations, databasePath } from "./migrations.ts"
import { createSqliteStore } from "./sqlite-store.ts"

const permissions = [
  "invoicing:read",
  "invoicing:customer.manage",
  "invoicing:invoice.draft",
  "invoicing:invoice.issue",
  "invoicing:settings.manage",
]

const context = (organizationId: string): RequestContextProvider => ({
  current: Effect.succeed({
    identity: { id: "user-1", username: "owner", roles: ["admin"], permissions },
    organization: { id: organizationId },
  }),
})

const clock: Clock = { now: Effect.succeed(new Date("2026-09-01T10:00:00.000Z")) }

const ids = (): IdGenerator => {
  let value = 0
  return { next: Effect.sync(() => `persistent-${String(++value)}`) }
}

void test("persists an issued snapshot across store recreation and isolates organizations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-sqlite-store-"))
  try {
    applyMigrations(directory)
    const service = createInvoicingService({
      context: context("org-1"),
      clock,
      ids: ids(),
      store: createSqliteStore(directory),
      cubeIdentity: "invoicing",
    })
    await Effect.runPromise(service.configureIssuer({
      legalName: "Exemplu SRL",
      taxIdentifier: "RO12345678",
      address: { countryCode: "RO", city: "Botoșani", street: "Strada Mare 1" },
      defaultCurrency: "RON",
      defaultPaymentTermDays: 15,
      defaultSeries: "QWBE",
      taxConfigurations: [{
        code: "RO_STANDARD",
        category: "standard",
        rate: "21.00",
        effectiveFrom: "2025-08-01",
      }],
    }))
    const customer = await Effect.runPromise(service.createCustomer({
      legalName: "Client SRL",
      taxIdentifier: "RO87654321",
      address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2" },
    }))
    const draft = await Effect.runPromise(service.createDraft({
      customerId: customer.id,
      issueDate: "2026-09-01",
    }))
    await Effect.runPromise(service.addDraftLine({
      draftId: draft.id,
      description: "Servicii software",
      quantity: "1.25",
      unitPrice: "100.00",
      taxCode: "RO_STANDARD",
    }))
    const issued = await Effect.runPromise(service.issueInvoice({ draftId: draft.id }))

    const restarted = createInvoicingService({
      context: context("org-1"),
      clock,
      ids: ids(),
      store: createSqliteStore(directory),
      cubeIdentity: "invoicing",
    })
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(issued.id)), issued)

    const database = new DatabaseSync(databasePath(directory))
    try {
      assert.throws(() => database.prepare("UPDATE issued_lines SET description = ? WHERE invoice_id = ?")
        .run("tampered", issued.id))
      assert.throws(() => database.prepare("DELETE FROM issued_lines WHERE invoice_id = ?").run(issued.id))
      assert.throws(() => database.prepare("UPDATE issued_tax_breakdown SET tax_amount = ? WHERE invoice_id = ?")
        .run("0.00", issued.id))
      assert.throws(() => database.prepare("DELETE FROM issued_tax_breakdown WHERE invoice_id = ?").run(issued.id))
    } finally {
      database.close()
    }
    assert.deepEqual(await Effect.runPromise(restarted.getIssuedInvoice(issued.id)), issued)

    const otherOrganization = createInvoicingService({
      context: context("org-2"),
      clock,
      ids: ids(),
      store: createSqliteStore(directory),
      cubeIdentity: "invoicing",
    })
    const failure = await Effect.runPromise(Effect.flip(otherOrganization.getIssuedInvoice(issued.id)))
    assert.equal(failure instanceof ResourceNotFound, true)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

void test("rolls sequence allocation back with the surrounding transaction", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-sqlite-rollback-"))
  try {
    applyMigrations(directory)
    const store = createSqliteStore(directory)
    const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) => Effect.gen(function*() {
      yield* transaction.allocateInvoiceNumber("org-1", 2026, "QWBE")
      return yield* Effect.fail(new DomainConflict({ code: "forced", message: "rollback" }))
    }))))
    assert.equal(failure instanceof DomainConflict, true)

    const allocated = await Effect.runPromise(store.transaction((transaction) =>
      transaction.allocateInvoiceNumber("org-1", 2026, "QWBE")))
    assert.equal(allocated, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
