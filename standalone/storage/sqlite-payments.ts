import type { DatabaseSync } from "node:sqlite"

import { Effect } from "effect"

import {
  DomainConflict, PersistenceFailure, type Payment, type PaymentsTransaction,
} from "../../cube/payments/index.ts"
import { nullableText, optionalText, row, text, type Row } from "./sqlite-rows.ts"
import { appendAuditEvent } from "./sqlite-kernel.ts"

const persistence = (operation: string) => new PersistenceFailure({ operation })
const write = <Value>(operation: string, run: () => Value): Effect.Effect<Value, DomainConflict | PersistenceFailure> => Effect.try({
  try: run,
  catch: (error) => typeof error === "object" && error !== null && "code" in error
      && typeof error.code === "string" && error.code.startsWith("SQLITE_CONSTRAINT")
    ? new DomainConflict({ code: "persistence_conflict", message: `Conflict while performing ${operation}` })
    : persistence(operation),
})
const read = <Value>(operation: string, run: () => Value): Effect.Effect<Value, PersistenceFailure> =>
  Effect.try({ try: run, catch: () => persistence(operation) })

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

export const paymentsTransactionAdapter = (database: DatabaseSync): PaymentsTransaction => ({
  findInvoiceSnapshot: (organizationId, id) => read("find issued invoice", () => {
    const value = row(database.prepare("SELECT * FROM issued_invoices WHERE organization_id = ? AND id = ?").get(organizationId, id))
    return value === undefined ? undefined : {
      id: text(value, "id"), organizationId: text(value, "organization_id"), currency: text(value, "currency"),
      dueDate: nullableText(value, "due_date"), totalIncludingVat: text(value, "total_including_tax"),
    }
  }),
  savePayment: (payment) => write("save payment", () => {
    const result = database.prepare(`INSERT INTO invoice_payments
      (id, invoice_id, organization_id, kind, reverses_payment_id, amount, currency, payment_date, method, external_reference, note, actor_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(payment.id, payment.invoiceId, payment.organizationId, payment.kind, payment.reversesPaymentId ?? null, payment.amount, payment.currency,
        payment.paymentDate, payment.method, payment.externalReference ?? null, payment.note ?? null, payment.actorId, payment.createdAt)
    if (result.changes === 0) throw new DomainConflict({ code: "payment_not_saved", message: "Payment could not be saved" })
  }),
  listPayments: (organizationId, invoiceId) => read("list payments", () =>
    database.prepare("SELECT * FROM invoice_payments WHERE organization_id = ? AND invoice_id = ? ORDER BY payment_date, created_at, id")
      .all(organizationId, invoiceId).map((value) => paymentFrom(value as Row))),
  findPayment: (organizationId, invoiceId, paymentId) => read("find payment", () => {
    const value = row(database.prepare("SELECT * FROM invoice_payments WHERE organization_id = ? AND invoice_id = ? AND id = ?").get(organizationId, invoiceId, paymentId))
    return value === undefined ? undefined : paymentFrom(value)
  }),
  findIdempotencyRecord: (organizationId, key) => read("find payment idempotency record", () => {
    const value = row(database.prepare("SELECT * FROM payment_idempotency_records WHERE organization_id = ? AND idempotency_key = ?").get(organizationId, key))
    return value === undefined ? undefined : {
      organizationId: text(value, "organization_id"), key: text(value, "idempotency_key"),
      operation: text(value, "operation") === "reverse_payment" ? "reverse_payment" : "record_payment",
      fingerprint: text(value, "fingerprint"), resultId: text(value, "result_id"), createdAt: text(value, "created_at"),
    }
  }),
  saveIdempotencyRecord: (record) => write("save payment idempotency record", () => {
    database.prepare(`INSERT INTO payment_idempotency_records (organization_id, idempotency_key, operation, fingerprint, result_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).run(record.organizationId, record.key, record.operation, record.fingerprint, record.resultId, record.createdAt)
  }),
  appendAuditEvent: (event) => write("append audit event", () => { appendAuditEvent(database, event) }),
})
