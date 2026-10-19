import type { Pool } from "pg"

import type { TransactionalStore } from "../../cubes/invoicing/index.ts"
import type { AnafEnvironment, StoredConnectionStatus } from "../../cubes/invoicing/efactura/connection/index.ts"
import { LIVE_STATES, type SubmissionsTransaction } from "../../cubes/invoicing/efactura/submissions/index.ts"
import { persistence, read, write } from "./postgres-errors.ts"
import { appendAuditEvent } from "./postgres-kernel.ts"
import {
  SUBMISSION_COLUMNS, STANDARDS, efacturaSubmissionsLockKey, oneOf, projectDocument, submissionFrom,
} from "./postgres-efactura-submission-rows.ts"
import { bytes, firstRow, optionalText, text } from "./postgres-rows.ts"
import { transactionWith, type TransactionClient } from "./postgres-transaction.ts"

const STATED = LIVE_STATES.map((state) => `'${state}'`).join(",")

export const submissionsAdapter = (client: TransactionClient, environment: AnafEnvironment): SubmissionsTransaction => {
  const one = async (sql: string, values: ReadonlyArray<string>) => {
    const row = firstRow((await client.query(sql, values)).rows)
    return row === undefined ? undefined : submissionFrom(row)
  }
  const stored = (sql: string, organizationId: string, id: string) => read("read e-Factura bytes", async () => {
    const row = firstRow((await client.query(sql, [organizationId, id])).rows)
    return row === undefined ? undefined : bytes(row, "content")
  })
  return {
    findCurrent: (organizationId, submittedIn, kind, documentId) => read("find e-Factura submission", () => one(
      `SELECT ${SUBMISSION_COLUMNS} FROM efactura_submissions WHERE organization_id=$1 AND environment=$2 AND document_kind=$3
        AND document_id=$4 AND NOT superseded AND state IN(${STATED})`, [organizationId, submittedIn, kind, documentId])),
    findConnection: (organizationId) => read("find e-Factura connection", async () => {
      const row = firstRow((await client.query(
        "SELECT status, verified_cif, refresh_expires_at FROM efactura_connections WHERE organization_id=$1 AND environment=$2",
        [organizationId, environment])).rows)
      if (row === undefined) return undefined
      const status = oneOf<StoredConnectionStatus>(["disconnected", "connected", "needs_reconnect"], row, "status")
      return { status, verifiedCif: optionalText(row, "verified_cif"), refreshExpiresAt: optionalText(row, "refresh_expires_at") }
    }),
    insert: (submission) => write("save e-Factura submission", async () => {
      const { rows } = await client.query(
        `INSERT INTO efactura_submissions(id,organization_id,environment,document_kind,document_id,standard,cif,xml,xml_sha256,xml_size,
          state,next_attempt_at,created_by,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::bytea,encode(sha256($8::bytea),'hex'),octet_length($8::bytea),'queued',$9,$10,$9,$9)
          RETURNING ${SUBMISSION_COLUMNS}`,
        [submission.id, submission.organizationId, submission.environment, submission.documentKind, submission.documentId,
          STANDARDS[submission.documentKind], submission.cif, submission.xml, submission.createdAt, submission.createdBy])
      const row = firstRow(rows)
      if (row === undefined) throw new Error("insert returned no row")
      return submissionFrom(row)
    }),
    project: (organizationId, kind, documentId, status) => write("project e-Factura status",
      () => projectDocument(client, organizationId, kind, documentId, status)),
    history: (organizationId, kind, documentId) => read("list e-Factura submissions", async () => (await client.query(
      `SELECT ${SUBMISSION_COLUMNS} FROM efactura_submissions WHERE organization_id=$1 AND document_kind=$2 AND document_id=$3
        ORDER BY created_at DESC, id DESC`, [organizationId, kind, documentId])).rows.map(submissionFrom)),
    resubmissions: (organizationId, kind, documentId) => read("list e-Factura resubmissions", async () => (await client.query(
      `SELECT r.previous_id,r.next_id,r.actor_id,r.created_at FROM efactura_resubmissions r JOIN efactura_submissions s ON s.id=r.previous_id
        WHERE r.organization_id=$1 AND s.document_kind=$2 AND s.document_id=$3 ORDER BY r.created_at DESC, r.next_id DESC`,
      [organizationId, kind, documentId])).rows.map((row) => ({ previousId: text(row, "previous_id"), nextId: text(row, "next_id"),
      actorId: text(row, "actor_id"), createdAt: text(row, "created_at") }))),
    readXml: (organizationId, id) => stored(
      "SELECT xml AS content FROM efactura_submissions WHERE organization_id=$1 AND id=$2", organizationId, id),
    readResponse: (organizationId, id) => stored(
      "SELECT archive AS content FROM efactura_responses WHERE organization_id=$1 AND submission_id=$2", organizationId, id),
    appendAuditEvent: (event) => write("append audit event", () => appendAuditEvent(client, event)),
  }
}

/** One short transaction per step, under the submissions key. No HTTP call ever runs inside one. */
export const createPostgresSubmissionsStore = (pool: Pool, environment: AnafEnvironment): TransactionalStore<SubmissionsTransaction> => ({
  transaction: transactionWith(pool, {
    lock: efacturaSubmissionsLockKey,
    adapter: (client: TransactionClient) => submissionsAdapter(client, environment),
    onBeginFailure: () => persistence("begin transaction"),
    onCommitFailure: () => persistence("commit transaction"),
  }),
})
