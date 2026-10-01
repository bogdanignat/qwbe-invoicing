import { accessSync, constants, mkdirSync } from "node:fs"

import type { Pool } from "pg"

import {
  applyMigrations as applyPostgresMigrations,
  applyMigrationsOnClient,
  assertCollationC,
  databaseReady as ledgerReady,
  ledgerTable,
  planMigrations as planPostgresMigrations,
  type MigrationReport,
  type SqlExecutor,
} from "./postgres-migrations.ts"
import { schemaDrift, schemaDriftOnClient } from "./postgres-schema-fingerprint.ts"
import { ScratchNotRolledBack } from "./postgres-schema-replay.ts"

/**
 * The host's view of the schema: one PostgreSQL database, one ledger, one
 * fingerprint. A facade and nothing else — the executor, the barrier and the
 * drift replay live in the `postgres-*` modules, and nothing here opens a
 * connection of its own.
 *
 * Every entry point is asynchronous because the database is remote now. The
 * callers that used to be synchronous (readiness, `doctor`, the session store)
 * became asynchronous with it; there is no synchronous wrapper, because one
 * would only be a blocking call pretending not to be.
 */

export { applyMigrationsOnClient, assertCollationC, ledgerTable, schemaDrift, schemaDriftOnClient }
/** The ledger half of readiness, for a caller that already owns a connection. */
export { ledgerReady }
export type { MigrationReport, SqlExecutor }

/** What a run would change, without changing anything. */
export const planMigrations = (executor: SqlExecutor): Promise<MigrationReport> =>
  planPostgresMigrations(executor)

/** The write path. Takes the exclusive maintenance barrier for the whole run. */
export const applyMigrations = (pool: Pool): Promise<MigrationReport> => applyPostgresMigrations(pool)

/**
 * Ready means the ledger explains the schema: nothing pending and no drift. A
 * drifted schema is NOT ready — no further migration reconciles it, so serving
 * on it would serve a schema the contracts do not describe.
 */
export const databaseReady = async (pool: Pool): Promise<boolean> => {
  const client = await pool.connect()
  // A replay whose ROLLBACK failed is the one error whose own definition says the
  // connection must be destroyed instead of recycled, and this is the call site
  // that cannot afford to ignore it: readiness runs every five seconds on the
  // application's pool of four, so a client given back inside an unknown
  // transaction state would fail the next `/api*` transactions with 25P02 until
  // `idle_in_transaction_session_timeout` killed the session. Same shape as
  // `schemaDrift` and `doctorReport`, which already release dirty.
  let dirty: Error | undefined
  try {
    if (!await ledgerReady(client)) return false
    return (await schemaDriftOnClient(client)).length === 0
  } catch (error) {
    if (error instanceof ScratchNotRolledBack) dirty = error
    throw error
  } finally {
    if (dirty === undefined) client.release()
    else client.release(dirty)
  }
}

/**
 * The filesystem half of readiness, which PostgreSQL did not take away: PDFs are
 * content-addressed files under `DATA_DIR`, so an unwritable data directory is
 * still a reason to refuse traffic. This is what is left of the old
 * `accessSync` pair — the one on the database file is gone with the file.
 */
export const artifactsDirectoryReady = (dataDirectory: string): boolean => {
  try {
    mkdirSync(dataDirectory, { recursive: true })
    accessSync(dataDirectory, constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}
