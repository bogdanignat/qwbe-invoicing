import type { AuditEvent, IdempotencyRecord, InvoicingTransaction } from "../../cube/invoicing/index.ts"
import { read, write } from "./postgres-errors.ts"
import { firstRow, text } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type KernelTransaction = Pick<InvoicingTransaction,
  "findIdempotencyRecord" | "saveIdempotencyRecord" | "appendAuditEvent">

export const appendAuditEvent = async (client: TransactionClient, event: AuditEvent): Promise<void> => {
  await client.query(
    `INSERT INTO audit_events(id,organization_id,actor_id,occurred_at,action,target_kind,target_id,reason)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [event.id, event.organizationId, event.actorId, event.occurredAt,
      event.action, event.targetKind, event.targetId, event.reason ?? null],
  )
}

export const kernelTransactionAdapter = (client: TransactionClient): KernelTransaction => ({
  findIdempotencyRecord: (organizationId, key) => read("find idempotency record", async () => {
    const { rows } = await client.query(
      "SELECT * FROM idempotency_records WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, key],
    )
    const value = firstRow(rows)
    return value === undefined ? undefined : {
      organizationId: text(value, "organization_id"), key: text(value, "idempotency_key"),
      operation: text(value, "operation") as IdempotencyRecord["operation"],
      fingerprint: text(value, "fingerprint"), resultKind: text(value, "result_kind") as IdempotencyRecord["resultKind"],
      resultId: text(value, "result_id"), createdAt: text(value, "created_at"),
    }
  }),
  saveIdempotencyRecord: (record) => write("save idempotency record", async () => {
    await client.query(
      `INSERT INTO idempotency_records
        (organization_id,idempotency_key,operation,fingerprint,result_kind,result_id,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [record.organizationId, record.key, record.operation, record.fingerprint,
        record.resultKind, record.resultId, record.createdAt],
    )
  }),
  appendAuditEvent: (event) => write("append audit event", () => appendAuditEvent(client, event)),
})
