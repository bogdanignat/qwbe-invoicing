import { randomUUID } from "node:crypto"

import { REFRESH_ACTOR, type AnafEnvironment } from "../../cubes/invoicing/efactura/connection/index.ts"
import {
  auditedArrival, canStoreArchive, documentStatus, fiscalTransition, submissionAudit, type ArchiveState, type CallOutcome,
  type FiscalEvent, type SubmissionRecord,
} from "../../cubes/invoicing/efactura/submissions/index.ts"
import { budgetStore } from "./postgres-efactura-budgets.ts"

export type { MessageCall } from "./postgres-efactura-budgets.ts"
import { SUBMISSION_COLUMNS, projectDocument, submissionFrom } from "./postgres-efactura-submission-rows.ts"
import { appendAuditEvent } from "./postgres-kernel.ts"
import { bytes, firstRow, integer } from "./postgres-rows.ts"
import type { QueryValue } from "./postgres-sql.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

export interface Due {
  readonly submission: SubmissionRecord
  /** How many times `stareMesaj` was already asked for this upload. */
  readonly polls: number
}

/** What a step changes besides the state. */
export interface Patch {
  readonly uploadIndex?: string
  readonly downloadId?: string
  readonly archiveState?: ArchiveState
  readonly errors?: ReadonlyArray<string> | undefined
  readonly polls?: number
  readonly nextAttemptAt?: string
}

/** One line of `efactura_submission_attempts`: never a body, never a token. */
export interface CallRecord {
  readonly operation: "validare" | "upload" | "stareMesaj" | "descarcare" | "listaMesaje"
  readonly outcome: CallOutcome
  readonly httpStatus: number | undefined
  readonly durationMs: number
  readonly startedAt: string
}


const COLUMNS: Readonly<Record<keyof Patch, string>> = {
  uploadIndex: "upload_index", downloadId: "download_id", archiveState: "archive_state", errors: "errors", polls: "polls",
  nextAttemptAt: "next_attempt_at",
}

const DUE = `SELECT ${SUBMISSION_COLUMNS},polls FROM efactura_submissions WHERE environment=$1 AND NOT superseded AND next_attempt_at<=$2
  AND (state IN('queued','processing') OR archive_state='pending') ORDER BY next_attempt_at,id LIMIT 1`

/**
 * The dispatcher's reads and writes inside one of its fenced transactions,
 * all at the instant `at`. A state change goes through the cube's transition
 * table, and the document's projection and the audit row go with it.
 */
export const dispatchStore = (client: TransactionClient, at: Date) => {
  const now = at.toISOString()

  const move = async (submission: SubmissionRecord, event: FiscalEvent | undefined, patch: Patch = {}): Promise<SubmissionRecord> => {
    const state = event === undefined ? submission.state : fiscalTransition(submission.state, event)
    if (state === undefined) throw new Error(`${String(event)} is not allowed from ${submission.state}`)
    const changes = Object.entries(patch).filter(([, value]) => value !== undefined) as Array<[keyof Patch, QueryValue | ReadonlyArray<string>]>
    const sets = changes.map(([key], index) => `${COLUMNS[key]}=$${String(index + 5)}`)
    const values = changes.map(([key, value]) => key === "errors" ? JSON.stringify(value) : value as QueryValue)
    const { rowCount } = await client.query(`UPDATE efactura_submissions SET ${["state=$3", "updated_at=$4", ...sets].join(",")}
      WHERE id=$1 AND state=$2`, [submission.id, submission.state, state, now, ...values])
    if (rowCount !== 1) throw new Error("the submission is not where the dispatcher left it")
    if (state === submission.state) return submission
    await projectDocument(client, submission.organizationId, submission.documentKind, submission.documentId, documentStatus(state))
    const action = auditedArrival(state)
    if (action !== undefined) await appendAuditEvent(client, submissionAudit(randomUUID(), submission, REFRESH_ACTOR, now, action, event))
    return { ...submission, state }
  }

  return {
    ...budgetStore(client, at),
    move,
    due: async (environment: AnafEnvironment): Promise<Due | undefined> => {
      const row = firstRow((await client.query(DUE, [environment, now])).rows)
      return row === undefined ? undefined : { submission: submissionFrom(row), polls: integer(row, "polls") }
    },
    xml: async (id: string): Promise<Uint8Array> => {
      const row = firstRow((await client.query("SELECT xml FROM efactura_submissions WHERE id=$1", [id])).rows)
      if (row === undefined) throw new Error("the submission is gone")
      return bytes(row, "xml")
    },
    log: async (submission: SubmissionRecord, call: CallRecord) => {
      await client.query(`INSERT INTO efactura_submission_attempts(id,submission_id,organization_id,operation,outcome,http_status,
        duration_ms,started_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), submission.id, submission.organizationId,
        call.operation, call.outcome, call.httpStatus ?? null, call.durationMs, call.startedAt])
    },
    storeArchive: async (submission: SubmissionRecord, archive: Uint8Array) => {
      if (!canStoreArchive(submission.state, submission.archiveState) || submission.downloadId === null) throw new Error("no archive is pending")
      await client.query(`INSERT INTO efactura_responses(submission_id,organization_id,download_id,archive,sha256,size,stored_at)
        VALUES($1,$2,$3,$4::bytea,encode(sha256($4::bytea),'hex'),octet_length($4::bytea),$5)`,
      [submission.id, submission.organizationId, submission.downloadId, archive, now])
      return move(submission, undefined, { archiveState: "stored" })
    },
    /** After the lock and the epoch: an upload in flight may have arrived (`unknown`); a validation simply starts over. */
    recover: async (environment: AnafEnvironment) => {
      const { rows } = await client.query(`SELECT ${SUBMISSION_COLUMNS} FROM efactura_submissions
        WHERE environment=$1 AND state IN('uploading','validating') ORDER BY id`, [environment])
      for (const submission of rows.map(submissionFrom)) {
        await move(submission, submission.state === "uploading" ? "recovered_upload" : "recovered_validation", { nextAttemptAt: now })
      }
    },
  }
}

export type DispatchStore = ReturnType<typeof dispatchStore>
