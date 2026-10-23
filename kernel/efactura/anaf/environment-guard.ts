import type { Pool } from "pg"

import { foreignEnvironments, type AnafEnvironment } from "../../../cubes/invoicing/efactura/connection/index.ts"

export class AnafEnvironmentMismatch extends Error {}

/**
 * `serve` refuses an `ANAF_ENVIRONMENT` other than the one the existing
 * e-Factura data was made in: polling a `test` index against `prod`, or
 * fetching received invoices from another system than the ones already
 * stored, would mix two systems' answers. Every received message and archive
 * hangs off a fetch, so the fetches stand for them. Runs regardless of
 * `QWBE_PLUGINS`, because the tables exist either way.
 */
export const assertAnafEnvironment = async (pool: Pool, configured: AnafEnvironment): Promise<void> => {
  const { rows } = await pool.query<{ readonly environment: string }>(
    "SELECT environment FROM efactura_submissions UNION SELECT environment FROM efactura_received_fetches")
  const foreign = foreignEnvironments(configured, rows.map(({ environment }) => environment))
  if (foreign.length === 0) return
  throw new AnafEnvironmentMismatch(
    `ANAF_ENVIRONMENT is ${configured}, but e-Factura data (submissions or received invoices) exists for ${foreign.join(", ")}; `
    + "set it back or start from a database without it")
}
