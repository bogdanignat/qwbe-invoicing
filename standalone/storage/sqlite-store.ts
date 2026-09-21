import { DatabaseSync } from "node:sqlite"

import { Effect } from "effect"

import type { InvoicingTransaction, TransactionalStore } from "../../cube/invoicing/index.ts"
import type { CatalogTransaction } from "../../cube/invoicing/catalog/index.ts"
import type { CorrectionsTransaction } from "../../cube/invoicing/corrections/index.ts"
import type { CustomersTransaction } from "../../cube/invoicing/customers/index.ts"
import type { ProformaTransaction } from "../../cube/invoicing/issuance/index.ts"
import type { IssuerTransaction } from "../../cube/invoicing/issuer/index.ts"
import type { PaymentsTransaction, TransactionalStore as PaymentsStore } from "../../cube/payments/index.ts"
import { databasePath } from "./migrations.ts"
import { catalogTransactionAdapter } from "./sqlite-catalog.ts"
import { correctionsTransactionAdapter } from "./sqlite-corrections.ts"
import { customersTransactionAdapter } from "./sqlite-customers.ts"
import { draftsTransactionAdapter } from "./sqlite-drafts.ts"
import { invoicesTransactionAdapter } from "./sqlite-invoices.ts"
import { issuerTransactionAdapter } from "./sqlite-issuer.ts"
import { kernelTransactionAdapter } from "./sqlite-kernel.ts"
import { paymentsPersistence, paymentsTransactionAdapter } from "./sqlite-payments.ts"
import { proformaConversionsTransactionAdapter } from "./sqlite-proforma-conversions.ts"
import { proformasTransactionAdapter } from "./sqlite-proformas.ts"
import { persistence } from "./sqlite-rows.ts"
import { seriesTransactionAdapter } from "./sqlite-series.ts"

type ApplicationTransaction = InvoicingTransaction & CustomersTransaction & CatalogTransaction & IssuerTransaction
  & ProformaTransaction & CorrectionsTransaction

interface TransactionHandle {
  readonly database: DatabaseSync
  open: boolean
  closed: boolean
}

const openTransaction = (dataDirectory: string): TransactionHandle => {
  let database: DatabaseSync | undefined
  try {
    database = new DatabaseSync(databasePath(dataDirectory))
    database.exec("PRAGMA foreign_keys = ON")
    database.exec("PRAGMA busy_timeout = 5000")
    database.exec("BEGIN IMMEDIATE")
    return { database, open: true, closed: false }
  } catch (error) {
    try { database?.close() } catch { /* acquisition failure wins */ }
    throw error
  }
}

const commitAndClose = (handle: TransactionHandle): void => {
  handle.database.exec("COMMIT")
  handle.open = false
  handle.database.close()
  handle.closed = true
}

const releaseTransaction = (handle: TransactionHandle): void => {
  if (handle.open) {
    try { handle.database.exec("ROLLBACK") } catch { /* original failure wins */ }
  }
  if (!handle.closed) {
    try { handle.database.close(); handle.closed = true } catch { /* original failure wins */ }
  }
}

const applicationTransactionAdapter = (database: DatabaseSync): ApplicationTransaction => ({
  ...seriesTransactionAdapter(database),
  ...draftsTransactionAdapter(database),
  ...invoicesTransactionAdapter(database),
  ...kernelTransactionAdapter(database),
  ...customersTransactionAdapter(database),
  ...catalogTransactionAdapter(database),
  ...issuerTransactionAdapter(database),
  ...proformasTransactionAdapter(database),
  ...proformaConversionsTransactionAdapter(database),
  ...correctionsTransactionAdapter(database),
})

// One connection and one BEGIN IMMEDIATE per transaction; every domain adapter is built
// on that same connection, so a composed operation commits or rolls back as one unit.
export const createSqliteStore = (dataDirectory: string): TransactionalStore<ApplicationTransaction> => ({
  transaction: (use) => Effect.acquireUseRelease(
    Effect.try({ try: () => openTransaction(dataDirectory), catch: () => persistence("begin transaction") }),
    (handle) => Effect.tap(use(applicationTransactionAdapter(handle.database)), () => Effect.try({
      try: () => { commitAndClose(handle) }, catch: () => persistence("commit transaction"),
    })),
    (handle) => Effect.sync(() => { releaseTransaction(handle) }),
  ),
})

export const createSqlitePaymentsStore = (dataDirectory: string): PaymentsStore<PaymentsTransaction> => ({
  transaction: (use) => Effect.acquireUseRelease(
    Effect.try({ try: () => openTransaction(dataDirectory), catch: () => paymentsPersistence("begin transaction") }),
    (handle) => Effect.tap(use(paymentsTransactionAdapter(handle.database)), () => Effect.try({
      try: () => { commitAndClose(handle) }, catch: () => paymentsPersistence("commit transaction"),
    })),
    (handle) => Effect.sync(() => { releaseTransaction(handle) }),
  ),
})
