import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict } from "../../cube/invoicing/index.ts"
import { applyMigrations } from "./migrations.ts"
import { catalogTransactionAdapter } from "./sqlite-catalog.ts"
import { correctionsTransactionAdapter } from "./sqlite-corrections.ts"
import { customersTransactionAdapter } from "./sqlite-customers.ts"
import { draftsTransactionAdapter } from "./sqlite-drafts.ts"
import { invoicesTransactionAdapter } from "./sqlite-invoices.ts"
import { issuerTransactionAdapter } from "./sqlite-issuer.ts"
import { kernelTransactionAdapter } from "./sqlite-kernel.ts"
import { paymentsTransactionAdapter } from "./sqlite-payments.ts"
import { proformaConversionsTransactionAdapter } from "./sqlite-proforma-conversions.ts"
import { proformasTransactionAdapter } from "./sqlite-proformas.ts"
import { seriesTransactionAdapter } from "./sqlite-series.ts"
import { createSqlitePaymentsStore, createSqliteStore } from "./sqlite-store.ts"

const expectedInvoicingKeys = [
  "addDocumentSeries", "allocateDocumentNumber", "appendAuditEvent", "deleteDraft", "deleteProductPreset",
  "findCorrection", "findCustomer", "findDocumentSeries", "findDraft", "findIdempotencyRecord",
  "findIssuedInvoice", "findIssuer", "findLatestIssueDate", "findProductPreset", "findProforma",
  "findProformaConversion", "findProformaInvoiceConversion", "hasOpenDraftsForCustomer", "listCorrections",
  "listCustomers", "listDocumentSeries", "listDrafts", "listIssuedInvoices", "listProductPresets",
  "listProformas", "saveCorrection", "saveCustomer", "saveDraft", "saveIdempotencyRecord",
  "saveIssuedInvoice", "saveIssuer", "saveProductPreset", "saveProforma", "saveProformaConversion",
  "saveProformaInvoiceConversion", "softDeleteCustomer",
]

void test("domain adapters have disjoint keys and compose the characterized transaction surface", async () => {
  const database = new DatabaseSync(":memory:")
  try {
    const adapters = [
      seriesTransactionAdapter(database), draftsTransactionAdapter(database), invoicesTransactionAdapter(database),
      kernelTransactionAdapter(database), customersTransactionAdapter(database), catalogTransactionAdapter(database),
      issuerTransactionAdapter(database), proformasTransactionAdapter(database),
      proformaConversionsTransactionAdapter(database), correctionsTransactionAdapter(database),
    ]
    const keys = adapters.map((adapter) => Object.keys(adapter))
    const flattened = keys.flat()
    assert.equal(new Set(flattened).size, flattened.length)
    assert.deepEqual([...flattened].sort(), expectedInvoicingKeys)

    const directory = mkdtempSync(join(tmpdir(), "qwbe-adapter-keys-"))
    try {
      applyMigrations(directory)
      const publicKeys = await Effect.runPromise(createSqliteStore(directory).transaction((transaction) =>
        Effect.succeed(Object.keys(transaction).sort())))
      assert.deepEqual(publicKeys, expectedInvoicingKeys)
      const paymentKeys = await Effect.runPromise(createSqlitePaymentsStore(directory).transaction((transaction) =>
        Effect.succeed(Object.keys(transaction).sort())))
      assert.deepEqual(paymentKeys, Object.keys(paymentsTransactionAdapter(database)).sort())
    } finally { rmSync(directory, { recursive: true, force: true }) }
  } finally { database.close() }
})

void test("public store rolls changes in different domain adapters back together", async () => {
  const directory = mkdtempSync(join(tmpdir(), "qwbe-cross-domain-rollback-"))
  try {
    applyMigrations(directory)
    const store = createSqliteStore(directory)
    const failure = await Effect.runPromise(Effect.flip(store.transaction((transaction) => Effect.gen(function*() {
      yield* transaction.saveCustomer({
        id: "customer-1", organizationId: "org-1", partyType: "company", name: "Client SRL",
        fiscalIdentifier: "87654329", vatRegistered: true,
        address: { countryCode: "RO", city: "Iași", street: "Strada Mică 2", county: "RO-IS" },
      })
      yield* transaction.saveProductPreset({
        id: "preset-1", organizationId: "org-1", description: "Servicii", unitPrice: "100.00",
        unitOfMeasure: { code: "C62", name: "unitate" },
      })
      return yield* Effect.fail(new DomainConflict({ code: "forced", message: "rollback" }))
    }))))
    assert.equal(failure instanceof DomainConflict, true)
    const persisted = await Effect.runPromise(store.transaction((transaction) => Effect.all([
      transaction.findCustomer("org-1", "customer-1"), transaction.findProductPreset("org-1", "preset-1"),
    ])))
    assert.deepEqual(persisted, [undefined, undefined])
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
