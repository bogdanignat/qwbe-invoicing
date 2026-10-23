import type { Pool } from "pg"

import type { TransactionalStore } from "../../cubes/invoicing/index.ts"
import type { AnafEnvironment } from "../../cubes/invoicing/efactura/connection/index.ts"
import type { ReceivedTransaction } from "../../cubes/invoicing/efactura/received/index.ts"
import { ACTIVE_FETCH, FETCH_COLUMNS, fetchFrom, gapValues } from "./postgres-efactura-received-rows.ts"
import { efacturaSubmissionsLockKey } from "./postgres-efactura-submission-rows.ts"
import { submissionsAdapter } from "./postgres-efactura-submissions.ts"
import { persistence, read, write } from "./postgres-errors.ts"
import { firstRow, text } from "./postgres-rows.ts"
import { transactionWith, type TransactionClient } from "./postgres-transaction.ts"

const adapter = (client: TransactionClient, environment: AnafEnvironment): ReceivedTransaction => ({
  findConnection: submissionsAdapter(client, environment).findConnection,
  findIssuerFiscalIdentifier: (organizationId) => read("find issuer fiscal identifier", async () => {
    const row = firstRow((await client.query("SELECT tax_identifier FROM issuers WHERE organization_id=$1", [organizationId])).rows)
    return row === undefined ? undefined : text(row, "tax_identifier")
  }),
  activeFetch: (organizationId, fetchedIn) => read("find active received-invoice fetch", async () => {
    const row = firstRow((await client.query(`SELECT ${FETCH_COLUMNS} FROM efactura_received_fetches
      WHERE organization_id=$1 AND environment=$2 AND ${ACTIVE_FETCH}`, [organizationId, fetchedIn])).rows)
    return row === undefined ? undefined : fetchFrom(row)
  }),
  coveredUntil: (organizationId, fetchedIn) => read("find received-invoice coverage", async () => {
    const row = firstRow((await client.query("SELECT covered_until FROM efactura_received_coverage WHERE organization_id=$1 AND environment=$2",
      [organizationId, fetchedIn])).rows)
    return row === undefined ? undefined : text(row, "covered_until")
  }),
  insertFetch: (fetch) => write("save received-invoice fetch", async () => {
    const [gapStart, gapEnd] = gapValues(fetch.window)
    const row = firstRow((await client.query(`INSERT INTO efactura_received_fetches(id,organization_id,environment,cif,window_start,window_end,
      gap_start,gap_end,state,next_attempt_at,created_by,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'listing',$9,$10,$9,$9)
      RETURNING ${FETCH_COLUMNS}`, [fetch.id, fetch.organizationId, fetch.environment, fetch.cif, fetch.window.start, fetch.window.end,
      gapStart, gapEnd, fetch.createdAt, fetch.createdBy])).rows)
    if (row === undefined) throw new Error("insert returned no row")
    return fetchFrom(row)
  }),
})

/**
 * A fetch is asked for under the submissions key, the dispatcher's own: the
 * check for an active fetch and the insert cannot be split by another request
 * or by the dispatcher finishing one.
 */
export const createPostgresReceivedStore = (pool: Pool, environment: AnafEnvironment): TransactionalStore<ReceivedTransaction> => ({
  transaction: transactionWith(pool, {
    lock: efacturaSubmissionsLockKey,
    adapter: (client: TransactionClient) => adapter(client, environment),
    onBeginFailure: () => persistence("begin transaction"),
    onCommitFailure: () => persistence("commit transaction"),
  }),
})
