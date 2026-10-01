import assert from "node:assert/strict"
import test from "node:test"

import { Effect } from "effect"

import { DomainConflict } from "../../cube/invoicing/index.ts"
import { catalogTransactionAdapter } from "./postgres-catalog.ts"
import { correctionsTransactionAdapter } from "./postgres-corrections.ts"
import { customersTransactionAdapter } from "./postgres-customers.ts"
import { draftsTransactionAdapter } from "./postgres-drafts.ts"
import { invoicesTransactionAdapter } from "./postgres-invoices.ts"
import { invoiceRegisterTransactionAdapter } from "./postgres-invoice-register.ts"
import { issuerTransactionAdapter } from "./postgres-issuer.ts"
import { kernelTransactionAdapter } from "./postgres-kernel.ts"
import { paymentsTransactionAdapter } from "./postgres-payments.ts"
import { proformaConversionsTransactionAdapter } from "./postgres-proforma-conversions.ts"
import { proformasTransactionAdapter } from "./postgres-proformas.ts"
import { seriesTransactionAdapter } from "./postgres-series.ts"
import { withMigrated } from "./postgres-rig.test-support.ts"
import { createPostgresPaymentsStore, createPostgresStore } from "./postgres-store.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

/**
 * The composition of the domain adapters, unchanged from the SQLite suite: the
 * same thirty-seven keys, still disjoint, still exactly what the public store
 * exposes, and still rolled back together across two domains.
 *
 * The key assertions take a client that is never used, because asking an adapter
 * which operations it owns is not a question about a database. The rollback
 * assertion takes the real pool, because that one is.
 */

const expectedInvoicingKeys = [
  "addDocumentSeries", "allocateDocumentNumber", "appendAuditEvent", "deleteDraft", "deleteProductPreset",
  "findCorrection", "findCustomer", "findDocumentSeries", "findDraft", "findIdempotencyRecord",
  "findIssuedInvoice", "findIssuer", "findLatestIssueDate", "findProductPreset", "findProforma",
  "findProformaConversion", "findProformaInvoiceConversion", "hasOpenDraftsForCustomer", "listCorrections",
  "listCustomers", "listDocumentSeries", "listDrafts", "listInvoiceRegister", "listIssuedInvoices", "listProductPresets",
  "listProformas", "saveCorrection", "saveCustomer", "saveDraft", "saveIdempotencyRecord",
  "saveIssuedInvoice", "saveIssuer", "saveProductPreset", "saveProforma", "saveProformaConversion",
  "saveProformaInvoiceConversion", "softDeleteCustomer",
]

const unusedClient: TransactionClient = {
  query: () => Promise.reject(new Error("the key assertions must not reach the database")),
}

void test("domain adapters have disjoint keys and compose the characterized transaction surface", async () => {
  const adapters = [
    seriesTransactionAdapter(unusedClient), draftsTransactionAdapter(unusedClient),
    invoicesTransactionAdapter(unusedClient), invoiceRegisterTransactionAdapter(unusedClient),
    kernelTransactionAdapter(unusedClient), customersTransactionAdapter(unusedClient),
    catalogTransactionAdapter(unusedClient), issuerTransactionAdapter(unusedClient),
    proformasTransactionAdapter(unusedClient), proformaConversionsTransactionAdapter(unusedClient),
    correctionsTransactionAdapter(unusedClient),
  ]
  const keys = adapters.map((adapter) => Object.keys(adapter))
  const flattened = keys.flat()
  assert.equal(new Set(flattened).size, flattened.length)
  assert.deepEqual([...flattened].sort(), expectedInvoicingKeys)

  await withMigrated("adapter_keys", async ({ pool }) => {
    const publicKeys = await Effect.runPromise(createPostgresStore(pool).transaction((transaction) =>
      Effect.succeed(Object.keys(transaction).sort())))
    assert.deepEqual(publicKeys, expectedInvoicingKeys)
    const paymentKeys = await Effect.runPromise(createPostgresPaymentsStore(pool).transaction((transaction) =>
      Effect.succeed(Object.keys(transaction).sort())))
    assert.deepEqual(paymentKeys, Object.keys(paymentsTransactionAdapter(unusedClient)).sort())
  })
})

void test("public store rolls changes in different domain adapters back together", async () => {
  await withMigrated("cross_rollback", async ({ pool }) => {
    const store = createPostgresStore(pool)
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
  })
})
