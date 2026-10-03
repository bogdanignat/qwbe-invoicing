import { Effect } from "effect"

import {
  DomainConflict, PersistenceFailure, type Payment, type PaymentsTransaction,
} from "../../cube/payments/index.ts"
import { isConflict } from "./postgres-errors.ts"
import { firstRow, nullableText, optionalText, text, type Row } from "./postgres-rows.ts"
import { appendAuditEvent } from "./postgres-kernel.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

/**
 * Payments has its own `DomainConflict`/`PersistenceFailure` pair, so the
 * mapping is local — but it recognises the same SQLSTATEs as the invoicing one
 * (`isConflict`), and for the same reason: a constraint or a trigger refusing
 * the write is a 409, anything else is a 500. There is no proforma exception
 * here; no payments operation has a conflict code of its own.
 */

const persistence = (operation: string) => new PersistenceFailure({ operation })

const write = <Value>(
  operation: string,
  run: () => Promise<Value>,
): Effect.Effect<Value, DomainConflict | PersistenceFailure> => Effect.tryPromise({
  try: run,
  catch: (error) => error instanceof DomainConflict
    ? error
    : isConflict(error)
      ? new DomainConflict({ code: "persistence_conflict", message: `Conflict while performing ${operation}` })
      : persistence(operation),
})

const read = <Value>(operation: string, run: () => Promise<Value>): Effect.Effect<Value, PersistenceFailure> =>
  Effect.tryPromise({ try: run, catch: () => persistence(operation) })

const paymentFrom = (value: Row): Payment => {
  const externalReference = optionalText(value, "external_reference")
  const note = optionalText(value, "note")
  const reversesPaymentId = optionalText(value, "reverses_payment_id")
  return {
    id: text(value, "id"), invoiceId: text(value, "invoice_id"), organizationId: text(value, "organization_id"),
    kind: text(value, "kind") === "reversal" ? "reversal" : "payment",
    ...(reversesPaymentId === undefined ? {} : { reversesPaymentId }), amount: text(value, "amount"),
    currency: text(value, "currency"), paymentDate: text(value, "payment_date"), method: text(value, "method"),
    ...(externalReference === undefined ? {} : { externalReference }), ...(note === undefined ? {} : { note }),
    actorId: text(value, "actor_id"), createdAt: text(value, "created_at"),
  }
}

export const paymentsPersistence = persistence

export const paymentsTransactionAdapter = (client: TransactionClient): PaymentsTransaction => ({
  findInvoiceSnapshot: (organizationId, id) => read("find issued invoice", async () => {
    const { rows } = await client.query(
      "SELECT * FROM issued_invoices WHERE organization_id = $1 AND id = $2", [organizationId, id],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : {
      id: text(value, "id"), organizationId: text(value, "organization_id"), currency: text(value, "currency"),
      dueDate: nullableText(value, "due_date"), totalIncludingVat: text(value, "total_including_tax"),
    }
  }),
  savePayment: (payment) => write("save payment", async () => {
    const { rowCount } = await client.query(
      `INSERT INTO invoice_payments
        (id, invoice_id, organization_id, kind, reverses_payment_id, amount, currency, payment_date, method,
         external_reference, note, actor_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [payment.id, payment.invoiceId, payment.organizationId, payment.kind, payment.reversesPaymentId ?? null,
        payment.amount, payment.currency, payment.paymentDate, payment.method,
        payment.externalReference ?? null, payment.note ?? null, payment.actorId, payment.createdAt],
    )
    if (rowCount === 0) {
      throw new DomainConflict({ code: "payment_not_saved", message: "Payment could not be saved" })
    }
  }),
  listPayments: (organizationId, invoiceId) => read("list payments", async () => {
    const { rows } = await client.query(
      `SELECT * FROM invoice_payments WHERE organization_id = $1 AND invoice_id = $2
        ORDER BY payment_date, created_at, id`, [organizationId, invoiceId],
    )
    return rows.map(paymentFrom)
  }),
  findPayment: (organizationId, invoiceId, paymentId) => read("find payment", async () => {
    const { rows } = await client.query(
      "SELECT * FROM invoice_payments WHERE organization_id = $1 AND invoice_id = $2 AND id = $3",
      [organizationId, invoiceId, paymentId],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : paymentFrom(value)
  }),
  findIdempotencyRecord: (organizationId, key) => read("find payment idempotency record", async () => {
    const { rows } = await client.query(
      "SELECT * FROM payment_idempotency_records WHERE organization_id = $1 AND idempotency_key = $2",
      [organizationId, key],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : {
      organizationId: text(value, "organization_id"), key: text(value, "idempotency_key"),
      operation: text(value, "operation") === "reverse_payment" ? "reverse_payment" : "record_payment",
      fingerprint: text(value, "fingerprint"), resultId: text(value, "result_id"), createdAt: text(value, "created_at"),
    }
  }),
  saveIdempotencyRecord: (record) => write("save payment idempotency record", async () => {
    await client.query(
      `INSERT INTO payment_idempotency_records
        (organization_id, idempotency_key, operation, fingerprint, result_id, created_at)
        VALUES ($1, $2, $3, $4, $5, $6)`,
      [record.organizationId, record.key, record.operation, record.fingerprint, record.resultId, record.createdAt],
    )
  }),
  appendAuditEvent: (event) => write("append audit event", () => appendAuditEvent(client, event)),
})
