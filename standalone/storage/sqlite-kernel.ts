import type { DatabaseSync } from "node:sqlite"

import type { AuditEvent, IdempotencyRecord, InvoicingTransaction } from "../../cube/invoicing/index.ts"
import { read, row, text, write } from "./sqlite-rows.ts"

type KernelTransaction = Pick<InvoicingTransaction, "findIdempotencyRecord" | "saveIdempotencyRecord" | "appendAuditEvent">

export const appendAuditEvent = (database: DatabaseSync, event: AuditEvent): void => {
  database.prepare(`INSERT INTO audit_events(id,organization_id,actor_id,occurred_at,action,target_kind,target_id,reason)
    VALUES(?,?,?,?,?,?,?,?)`).run(event.id, event.organizationId, event.actorId, event.occurredAt,
    event.action, event.targetKind, event.targetId, event.reason ?? null)
}

export const kernelTransactionAdapter = (database: DatabaseSync): KernelTransaction => ({
  findIdempotencyRecord: (organizationId, key) => read("find idempotency record", () => {
    const value = row(database.prepare("SELECT * FROM idempotency_records WHERE organization_id=? AND idempotency_key=?")
      .get(organizationId, key))
    return value === undefined ? undefined : {
      organizationId: text(value, "organization_id"), key: text(value, "idempotency_key"),
      operation: text(value, "operation") as IdempotencyRecord["operation"],
      fingerprint: text(value, "fingerprint"), resultKind: text(value, "result_kind") as IdempotencyRecord["resultKind"],
      resultId: text(value, "result_id"), createdAt: text(value, "created_at"),
    }
  }),
  saveIdempotencyRecord: (record) => write("save idempotency record", () => {
    database.prepare(`INSERT INTO idempotency_records
      (organization_id,idempotency_key,operation,fingerprint,result_kind,result_id,created_at) VALUES(?,?,?,?,?,?,?)`)
      .run(record.organizationId, record.key, record.operation, record.fingerprint, record.resultKind, record.resultId, record.createdAt)
  }),
  appendAuditEvent: (event) => write("append audit event", () => { appendAuditEvent(database, event) }),
})
