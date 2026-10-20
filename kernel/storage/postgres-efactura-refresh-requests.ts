import type { AnafEnvironment } from "../../cubes/invoicing/efactura/connection/index.ts"
import { firstRow, text } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

/**
 * A request that called ANAF and was refused (401/403) never refreshes the
 * token itself: the dispatcher is the only refresher. It leaves a flag on the
 * connection row instead, set only on the very pair it was refused with, so a
 * pair that is already newer is left alone. Every write of the row (a refresh,
 * a disconnect, a reconnect) clears it.
 */
export const requestRefresh = async (client: TransactionClient, organizationId: string, generation: number, revision: number): Promise<void> => {
  await client.query(`UPDATE efactura_connections SET refresh_requested=true
    WHERE organization_id=$1 AND status='connected' AND generation=$2 AND revision=$3`, [organizationId, generation, revision])
}

/** The dispatcher takes one request at a time, clearing it as it takes it: a refresh that fails is asked for again, never looped. */
export const takeRefreshRequest = async (client: TransactionClient, environment: AnafEnvironment): Promise<string | undefined> => {
  const row = firstRow((await client.query(`UPDATE efactura_connections SET refresh_requested=false WHERE organization_id=(
    SELECT organization_id FROM efactura_connections WHERE environment=$1 AND refresh_requested ORDER BY organization_id LIMIT 1)
    RETURNING organization_id`, [environment])).rows)
  return row === undefined ? undefined : text(row, "organization_id")
}
