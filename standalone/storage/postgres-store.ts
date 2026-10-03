import type { Pool } from "pg"

import type { InvoicingTransaction, TransactionalStore } from "../../cube/invoicing/index.ts"
import type { CatalogTransaction } from "../../cube/invoicing/catalog/index.ts"
import type { CorrectionsTransaction } from "../../cube/invoicing/corrections/index.ts"
import type { CustomersTransaction } from "../../cube/invoicing/customers/index.ts"
import type { ProformaTransaction } from "../../cube/invoicing/issuance/index.ts"
import type { IssuerTransaction } from "../../cube/invoicing/issuer/index.ts"
import type { PaymentsTransaction, TransactionalStore as PaymentsStore } from "../../cube/payments/index.ts"
import { persistence } from "./postgres-errors.ts"
import { catalogTransactionAdapter } from "./postgres-catalog.ts"
import { correctionsTransactionAdapter } from "./postgres-corrections.ts"
import { customersTransactionAdapter } from "./postgres-customers.ts"
import { draftsTransactionAdapter } from "./postgres-drafts.ts"
import { invoicesTransactionAdapter } from "./postgres-invoices.ts"
import { invoiceRegisterTransactionAdapter } from "./postgres-invoice-register.ts"
import { issuerTransactionAdapter } from "./postgres-issuer.ts"
import { kernelTransactionAdapter } from "./postgres-kernel.ts"
import { paymentsPersistence, paymentsTransactionAdapter } from "./postgres-payments.ts"
import { proformaConversionsTransactionAdapter } from "./postgres-proforma-conversions.ts"
import { proformasTransactionAdapter } from "./postgres-proformas.ts"
import { seriesTransactionAdapter } from "./postgres-series.ts"
import { businessLockKey, transactionWith, type TransactionClient } from "./postgres-transaction.ts"

export type ApplicationTransaction = InvoicingTransaction & CustomersTransaction & CatalogTransaction
  & IssuerTransaction & ProformaTransaction & CorrectionsTransaction

const applicationTransactionAdapter = (client: TransactionClient): ApplicationTransaction => ({
  ...seriesTransactionAdapter(client),
  ...draftsTransactionAdapter(client),
  ...invoicesTransactionAdapter(client),
  ...invoiceRegisterTransactionAdapter(client),
  ...kernelTransactionAdapter(client),
  ...customersTransactionAdapter(client),
  ...catalogTransactionAdapter(client),
  ...issuerTransactionAdapter(client),
  ...proformasTransactionAdapter(client),
  ...proformaConversionsTransactionAdapter(client),
  ...correctionsTransactionAdapter(client),
})

/**
 * One checked-out connection and one transaction per operation, with the
 * maintenance barrier and the exclusive business lock taken before the first
 * domain read — the same serialisation `BEGIN IMMEDIATE` gave, including for
 * read-only operations. There is no read-only fast path: a reader that skipped
 * the lock could observe a half-applied issuance.
 *
 * The pool is injected. Nothing here creates, ends or owns it: the process that
 * built the pool closes it, once, when it shuts down.
 */
export const createPostgresStore = (pool: Pool): TransactionalStore<ApplicationTransaction> => ({
  transaction: transactionWith(pool, {
    lock: businessLockKey,
    adapter: applicationTransactionAdapter,
    onBeginFailure: () => persistence("begin transaction"),
    onCommitFailure: () => persistence("commit transaction"),
  }),
})

/** Payments shares the business lock: today it is the same transaction surface. */
export const createPostgresPaymentsStore = (pool: Pool): PaymentsStore<PaymentsTransaction> => ({
  transaction: transactionWith(pool, {
    lock: businessLockKey,
    adapter: paymentsTransactionAdapter,
    onBeginFailure: () => paymentsPersistence("begin transaction"),
    onCommitFailure: () => paymentsPersistence("commit transaction"),
  }),
})

/**
 * A business-locked transaction that hands the raw client over, for the two id
 * listings the documents port needs and no transaction port exposes. Same lock,
 * same ordering as every other business transaction.
 */
export const businessTransaction = (pool: Pool) => transactionWith(pool, {
  lock: businessLockKey,
  adapter: (client: TransactionClient) => client,
  onBeginFailure: () => persistence("begin transaction"),
  onCommitFailure: () => persistence("commit transaction"),
})
