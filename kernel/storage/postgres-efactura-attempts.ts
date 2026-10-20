import { DomainConflict } from "../../cubes/invoicing/index.ts"
import type { AttemptRecord, ConnectionTransaction } from "../../cubes/invoicing/efactura/connection/index.ts"
import { read, write } from "./postgres-errors.ts"
import { firstRow, integer, text, type Row } from "./postgres-rows.ts"
import type { TransactionClient } from "./postgres-transaction.ts"

type AttemptsTransaction = Pick<ConnectionTransaction,
  "findAttempt" | "findAttemptByHash" | "saveAttempt" | "consumeAttempt" | "deleteAttempt">

const attemptFrom = (row: Row): AttemptRecord => ({
  organizationId: text(row, "organization_id"), nonceHash: text(row, "nonce_sha256"), generation: integer(row, "generation"),
  consumed: row.consumed === true, createdBy: text(row, "created_by"), createdAt: text(row, "created_at"), expiresAt: text(row, "expires_at"),
})

/** The organization's one OAuth attempt: a new one overwrites the row, so a replaced nonce no longer exists. */
export const attemptsAdapter = (client: TransactionClient): AttemptsTransaction => {
  const attempt = (where: "organization_id" | "nonce_sha256", value: string) => read("find e-Factura attempt", async () => {
    const { rows } = await client.query(`SELECT * FROM efactura_oauth_attempts WHERE ${where} = $1`, [value])
    const row = firstRow(rows)
    return row === undefined ? undefined : attemptFrom(row)
  })
  return {
    findAttempt: (organizationId) => attempt("organization_id", organizationId),
    findAttemptByHash: (nonceHash) => attempt("nonce_sha256", nonceHash),
    saveAttempt: (next) => write("save e-Factura attempt", async () => {
      await client.query(
        `INSERT INTO efactura_oauth_attempts (organization_id, nonce_sha256, generation, consumed, created_by, created_at, expires_at)
          VALUES ($1, $2, $3, false, $4, $5, $6)
          ON CONFLICT (organization_id) DO UPDATE SET nonce_sha256 = EXCLUDED.nonce_sha256, generation = EXCLUDED.generation,
            consumed = false, created_by = EXCLUDED.created_by, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
        [next.organizationId, next.nonceHash, next.generation, next.createdBy, next.createdAt, next.expiresAt])
    }),
    consumeAttempt: (organizationId, nonceHash) => write("consume e-Factura attempt", async () => {
      const { rowCount } = await client.query(
        "UPDATE efactura_oauth_attempts SET consumed = true WHERE organization_id = $1 AND nonce_sha256 = $2 AND NOT consumed",
        [organizationId, nonceHash])
      if (rowCount !== 1) throw new DomainConflict({ code: "efactura_attempt_not_consumed", message: "the attempt was not consumed" })
    }),
    deleteAttempt: (organizationId) => write("delete e-Factura attempt", async () => {
      await client.query("DELETE FROM efactura_oauth_attempts WHERE organization_id = $1", [organizationId])
    }),
  }
}
