import type { Pool } from "pg"

import { foreignEnvironments, type AnafEnvironment } from "../../../cubes/invoicing/efactura/connection/index.ts"

export class AnafEnvironmentMismatch extends Error {}

/**
 * `serve` refuses an `ANAF_ENVIRONMENT` other than the one the existing
 * submissions were made in: polling a `test` index against `prod`, or the
 * reverse, would read another system's answer. Runs regardless of
 * `QWBE_PLUGINS`, because the table exists either way.
 */
export const assertAnafEnvironment = async (pool: Pool, configured: AnafEnvironment): Promise<void> => {
  const { rows } = await pool.query<{ readonly environment: string }>("SELECT DISTINCT environment FROM efactura_submissions")
  const foreign = foreignEnvironments(configured, rows.map(({ environment }) => environment))
  if (foreign.length === 0) return
  throw new AnafEnvironmentMismatch(
    `ANAF_ENVIRONMENT is ${configured}, but e-Factura submissions exist for ${foreign.join(", ")}; set it back or start from a database without them`)
}
