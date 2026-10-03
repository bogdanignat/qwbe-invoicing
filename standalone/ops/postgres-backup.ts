import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Pool, PoolClient } from "pg"

import {
  releaseMaintenanceLock,
  tryAcquireMaintenanceLock,
} from "../storage/postgres-maintenance-lock.ts"
import type { PostgresSettings } from "../storage/postgres-pool.ts"
import { type BackupReport, type BackupSession, createBackup, planBackupFiles } from "./postgres-backup-create.ts"
import { applicationBackends, assertServerMajor16, assertTargetMatches, GuardRefusal } from "./postgres-backup-guards.ts"
import { type RestoreReport, planRestoreFiles, restoreBackup } from "./postgres-backup-restore.ts"

/**
 * The operational surface of PostgreSQL backup and restore: four functions, one
 * context, and every unsafe thing already decided inside.
 *
 * The context is deliberately its own type and not the runtime configuration. A
 * backup needs a pool, the connection settings the subprocesses have to be told
 * about, and the directory the PDFs live in — nothing else. Handing it the whole
 * configuration would couple this module to the shape of the application's boot
 * and make it untestable without one.
 *
 * What lives here and nowhere else: the maintenance barrier and the staging
 * directory. Both are brackets, so a service below cannot forget to release a lock
 * or to discard a temporary tree, and neither of them can be acquired twice on two
 * connections — the self-deadlock `postgres-maintenance-lock.ts` warns about.
 *
 * Ownership: the pool is the caller's. Nothing here ends it; a command closes it
 * in its own `finally`.
 */

export interface BackupContext {
  readonly pool: Pool
  readonly settings: PostgresSettings
  readonly dataDirectory: string
}

export type { BackupReport } from "./postgres-backup-create.ts"
export type { RestoreReport } from "./postgres-backup-restore.ts"
export { RestoreInterrupted } from "./postgres-backup-restore.ts"

/**
 * The trust model, as one exported string, because the CLI has to say it out loud.
 *
 * `database.sql` is executed by `psql` as the application's database role. The
 * archive is validated exhaustively as a filesystem object — names, member types,
 * sizes, digests, manifest consistency, tool majors — and not at all as SQL. The
 * digests live inside the same archive as the files they describe, so they prove
 * integrity and not authenticity: anyone who can write the archive can recompute
 * them. There is no signature and no key management here, deliberately.
 *
 * The integration step is expected to print this before `restore --apply`.
 */
export const restoreTrustWarning =
  "restore executes database.sql as the application's database role. The archive is checked for structure "
  + "and integrity, never for authenticity: its checksums live inside it, so anyone able to write the archive "
  + "can recompute them. Restore only from a source trusted as much as the database itself."

/**
 * One checked-out client for the whole operation.
 *
 * A failure releases it destructively. The connection may be mid-transaction, may
 * still hold a session lock, and the operation that failed is not in a position to
 * know which — so it is discarded rather than handed back to serve a query. On the
 * success path the lock is released explicitly first, so the connection returns
 * clean and reusable.
 */
const withClient = async <Value>(
  pool: Pool,
  use: (client: PoolClient, discard: () => void) => Promise<Value>,
): Promise<Value> => {
  const client = await pool.connect()
  let poisoned: Error | undefined
  try {
    const value = await use(client, () => { poisoned ??= new Error("connection left in an unknown state") })
    // A body that succeeded but could not clean up still leaves a connection that
    // may hold a session lock; it is destroyed rather than returned to the pool,
    // where it would make the next maintenance command wait forever.
    client.release(poisoned)
    return value
  } catch (error) {
    client.release(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/**
 * The application-stopped invariant, enforced rather than documented.
 *
 * `pg_try_advisory_lock` answers immediately: the running application holds the
 * same key SHARED for the life of its process, so a refusal here means writers are
 * live. It is a bounded refusal and not a wait, because a maintenance command that
 * blocks behind a healthy application looks like a hang. The lock lives on this one
 * session for the whole operation, which is also why no service below may take it
 * again on another connection.
 */
const withExclusiveMaintenance = async <Value>(
  pool: Pool,
  operation: string,
  use: (client: PoolClient) => Promise<Value>,
): Promise<Value> =>
  withClient(pool, async (client, discard) => {
    if (!await tryAcquireMaintenanceLock(client)) {
      const backends = await applicationBackends(client)
      throw new GuardRefusal(
        `${operation} requires the application to be stopped: the maintenance lock is held`
        + ` (${String(backends)} application backends connected). Nothing was read or written.`,
      )
    }
    try {
      return await use(client)
    } finally {
      // The release must not become the reported failure. If the operation died
      // because the connection did, this query throws too, and its error would
      // replace the only useful diagnostic — the redacted `pg_dump failed (...)`.
      // The connection is discarded instead, which drops the lock with it.
      await releaseMaintenanceLock(client).catch(() => { discard() })
    }
  })

/**
 * A private staging tree under `TMPDIR`, discarded on every path. `mkdtemp` gives it
 * a name nobody else can predict and a mode only this process can enter, which is
 * what makes the "validate, then extract" pair safe: the directory the second pass
 * writes into is one this process just created.
 */
const withStaging = async <Value>(
  prefix: string,
  use: (staging: string) => Promise<Value>,
): Promise<Value> => {
  const staging = await mkdtemp(join(tmpdir(), prefix))
  try {
    return await use(staging)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

/** Read-only, lock-free: what a backup would contain if it ran now. */
export const planBackup = async (
  context: BackupContext,
): Promise<{ readonly pending: ReadonlyArray<string> }> =>
  withClient(context.pool, async (client) => {
    await assertServerMajor16(client)
    await assertTargetMatches(client, context.settings.database)
    return { pending: await planBackupFiles(context.dataDirectory) }
  })

export const executeBackup = async (context: BackupContext, output: string): Promise<BackupReport> =>
  withExclusiveMaintenance(context.pool, "backup", async (client) =>
    withStaging("qwbe-pg-backup-", async (staging) => {
      const session: BackupSession = {
        client, settings: context.settings, dataDirectory: context.dataDirectory, staging,
      }
      return createBackup(session, output)
    }))

/**
 * Read-only, and lock-free on purpose: a dry run has to be able to report that the
 * target is populated while the application is still up. It validates the whole
 * input, reads the target's inventory, and never names it to `psql`.
 */
export const planRestore = async (
  context: BackupContext,
  input: string,
): Promise<{ readonly pending: ReadonlyArray<string> }> =>
  withClient(context.pool, async (client) => ({
    pending: await planRestoreFiles(
      { client, settings: context.settings, dataDirectory: context.dataDirectory },
      input,
    ),
  }))

export const executeRestore = async (context: BackupContext, input: string): Promise<RestoreReport> =>
  withExclusiveMaintenance(context.pool, "restore", async (client) =>
    withStaging("qwbe-pg-restore-", async (staging) => {
      const session: BackupSession = {
        client, settings: context.settings, dataDirectory: context.dataDirectory, staging,
      }
      return restoreBackup(session, input)
    }))
