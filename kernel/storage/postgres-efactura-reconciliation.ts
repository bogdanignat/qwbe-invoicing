import type { Pool } from "pg"

import { DomainConflict, type TransactionalStore } from "../../cubes/invoicing/index.ts"
import type { AnafEnvironment } from "../../cubes/invoicing/efactura/connection/index.ts"
import type { ReconciliationTransaction } from "../../cubes/invoicing/efactura/reconciliation/index.ts"
import { budgetStore } from "./postgres-efactura-budgets.ts"
import { dispatchStore } from "./postgres-efactura-dispatch.ts"
import { requestRefresh } from "./postgres-efactura-refresh-requests.ts"
import { SUBMISSION_COLUMNS, efacturaSubmissionsLockKey, submissionFrom } from "./postgres-efactura-submission-rows.ts"
import { submissionsAdapter } from "./postgres-efactura-submissions.ts"
import { persistence, read, write } from "./postgres-errors.ts"
import { firstRow } from "./postgres-rows.ts"
import { transactionWith, type TransactionClient } from "./postgres-transaction.ts"

const moved = () => new DomainConflict({ code: "efactura_not_unknown", message: "the submission is no longer a current unknown one" })

const adapter = (client: TransactionClient, environment: AnafEnvironment): ReconciliationTransaction => {
  const one = async (sql: string, values: ReadonlyArray<string>) => {
    const row = firstRow((await client.query(sql, values)).rows)
    return row === undefined ? undefined : submissionFrom(row)
  }
  return {
    ...submissionsAdapter(client, environment),
    find: (organizationId, id) => read("find e-Factura submission", () => one(
      `SELECT ${SUBMISSION_COLUMNS} FROM efactura_submissions WHERE organization_id=$1 AND id=$2`, [organizationId, id])),
    findByUploadIndex: (organizationId, submittedIn, uploadIndex) => read("find e-Factura upload index", () => one(
      `SELECT ${SUBMISSION_COLUMNS} FROM efactura_submissions WHERE organization_id=$1 AND environment=$2 AND upload_index=$3`,
      [organizationId, submittedIn, uploadIndex])),
    replacement: (organizationId, previousId) => read("find e-Factura resubmission", () => one(
      `SELECT ${SUBMISSION_COLUMNS.split(",").map((column) => `s.${column}`).join(",")} FROM efactura_resubmissions r
        JOIN efactura_submissions s ON s.id=r.next_id WHERE r.organization_id=$1 AND r.previous_id=$2`, [organizationId, previousId])),
    reserveCall: (organizationId, at) => write("reserve an ANAF call", () => budgetStore(client, at).reserve(organizationId)),
    logCall: (submission, call) => write("log an ANAF call", () =>
      dispatchStore(client, new Date(call.startedAt)).log(submission, { ...call, operation: "listaMesaje" })),
    pause: (organizationId, retryAfter, at) => write("pause ANAF calls", async () => { await budgetStore(client, at).pause(organizationId, retryAfter) }),
    requestRefresh: (organizationId, token) => write("request an ANAF token refresh",
      () => requestRefresh(client, organizationId, token.generation, token.revision)),
    link: (submission, state, uploadIndex, at) => write("link e-Factura upload index", async () => {
      const row = firstRow((await client.query(`UPDATE efactura_submissions SET state=$3,upload_index=$4,polls=0,errors='[]',
        next_attempt_at=$5,updated_at=$5 WHERE organization_id=$1 AND id=$2 AND state='unknown' AND NOT superseded RETURNING ${SUBMISSION_COLUMNS}`,
      [submission.organizationId, submission.id, state, uploadIndex, at])).rows)
      if (row === undefined) throw moved()
      return submissionFrom(row)
    }),
    supersede: (submission, at) => write("supersede e-Factura submission", async () => {
      const { rowCount } = await client.query(`UPDATE efactura_submissions SET superseded=true,updated_at=$3
        WHERE organization_id=$1 AND id=$2 AND state='unknown' AND NOT superseded`, [submission.organizationId, submission.id, at])
      if (rowCount !== 1) throw moved()
    }),
    recordResubmission: (organizationId, resubmission) => write("save e-Factura resubmission", async () => {
      await client.query(`INSERT INTO efactura_resubmissions(previous_id,next_id,organization_id,actor_id,created_at,duplicate_risk_confirmed)
        VALUES($1,$2,$3,$4,$5,true)`, [resubmission.previousId, resubmission.nextId, organizationId, resubmission.actorId, resubmission.createdAt])
    }),
  }
}

/** Under the submissions key, like every other submission write: the dispatcher and a resubmit never interleave. */
export const createPostgresReconciliationStore = (pool: Pool, environment: AnafEnvironment): TransactionalStore<ReconciliationTransaction> => ({
  transaction: transactionWith(pool, {
    lock: efacturaSubmissionsLockKey,
    adapter: (client: TransactionClient) => adapter(client, environment),
    onBeginFailure: () => persistence("begin transaction"),
    onCommitFailure: () => persistence("commit transaction"),
  }),
})
