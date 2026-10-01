import { setTimeout as delay } from "node:timers/promises"

import type { Pool, PoolClient } from "pg"

import { migrationCount, migrationKey, migrationScopes } from "./postgres-migration-plans.ts"
import { releaseMaintenanceLock, tryAcquireMaintenanceLock } from "./postgres-maintenance-lock.ts"

/**
 * The migration executor, on PostgreSQL and asynchronous.
 *
 * Ownership is in the types and there is no hidden pooling:
 * - a function that takes a `Pool` checks a client out and gives it back;
 * - a function that takes a `PoolClient` uses the caller's connection and never
 *   releases, destroys or ends it.
 *
 * `applyMigrations` is the only entry point that takes the exclusive
 * maintenance barrier, and it takes it with a bounded try rather than a
 * blocking wait: with the application up — it holds the barrier SHARED for the
 * life of its process — an unbounded `pg_advisory_lock` would hang with no
 * diagnostic. `applyMigrationsOnClient` is the same work without the barrier,
 * for a caller that already holds it on the client it passes; acquiring it a
 * second time on another connection would self-deadlock.
 */

/** A `pg` handle the caller owns: a `Pool` or a checked-out `PoolClient`. */
export type SqlExecutor = Pick<PoolClient, "query">

export interface MigrationReport {
  readonly scanned: number
  readonly changed: number
  readonly skipped: number
  readonly failed: number
  readonly pending: ReadonlyArray<string>
}

export const ledgerTable = "schema_migrations"

/**
 * The ledger. `(scope, name)` because one database now holds every scope, and
 * nothing more: no checksum column, so a reapply is a no-op decided by presence
 * and never by content.
 */
const ledgerDefinition = `CREATE TABLE IF NOT EXISTS ${ledgerTable}(
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (scope, name)
)`

/**
 * The cluster precondition, asserted on the target before the first write.
 *
 * Ordering is a contract here: the SQLite baseline ordered text binary, and
 * only `C` reproduces that. Regular-expression bracket expressions and
 * uniqueness are collation independent, so the CHECKs are not at risk — index
 * order is, which is why this refuses instead of warning.
 */
export const assertCollationC = async (executor: SqlExecutor): Promise<void> => {
  const { rows } = await executor.query<{ readonly datcollate: string; readonly datctype: string }>(
    "SELECT datcollate, datctype FROM pg_database WHERE datname = current_database()",
  )
  const observed = rows[0]
  if (observed?.datcollate !== "C" || observed.datctype !== "C") {
    throw new Error(
      `the target database must be LC_COLLATE 'C' LC_CTYPE 'C'; it is `
      + `${JSON.stringify(observed?.datcollate)}/${JSON.stringify(observed?.datctype)}`,
    )
  }
}

const ledgerExists = async (executor: SqlExecutor): Promise<boolean> => {
  const { rows } = await executor.query<{ readonly present: boolean }>(
    "SELECT to_regclass($1) IS NOT NULL AS present",
    [ledgerTable],
  )
  return rows[0]?.present === true
}

const appliedKeys = async (executor: SqlExecutor): Promise<ReadonlySet<string>> => {
  if (!await ledgerExists(executor)) return new Set()
  const { rows } = await executor.query<{ readonly scope: string; readonly name: string }>(
    `SELECT scope, name FROM ${ledgerTable}`,
  )
  return new Set(rows.map(({ scope, name }) => migrationKey(scope, name)))
}

const pendingKeys = (applied: ReadonlySet<string>): ReadonlyArray<string> =>
  migrationScopes.flatMap(({ scope, migrations }) => migrations
    .map(({ name }) => migrationKey(scope, name))
    .filter((key) => !applied.has(key)))

/** Read path: what a run would change, without changing anything. */
export const planMigrations = async (executor: SqlExecutor): Promise<MigrationReport> => {
  const pending = pendingKeys(await appliedKeys(executor))
  const scanned = migrationCount()
  return { scanned, changed: 0, skipped: scanned - pending.length, failed: 0, pending }
}

const applyMigration = async (
  client: PoolClient,
  scope: string,
  migration: { readonly name: string; readonly statements: ReadonlyArray<string> },
): Promise<void> => {
  // One transaction per migration: PostgreSQL DDL is transactional, so a
  // migration and its ledger row commit together or neither does.
  await client.query("BEGIN")
  try {
    for (const statement of migration.statements) await client.query(statement)
    await client.query(
      `INSERT INTO ${ledgerTable} (scope, name, applied_at) VALUES ($1, $2, now())`,
      [scope, migration.name],
    )
    await client.query("COMMIT")
  } catch (error) {
    try { await client.query("ROLLBACK") } catch { /* the original failure wins */ }
    throw error
  }
}

/**
 * Applies every pending migration on a client the caller owns and already
 * guards. Takes no lock: the caller holds the exclusive maintenance barrier.
 */
export const applyMigrationsOnClient = async (client: PoolClient): Promise<MigrationReport> => {
  await assertCollationC(client)
  await client.query(ledgerDefinition)
  const applied = await appliedKeys(client)
  let changed = 0
  for (const { scope, migrations } of migrationScopes) {
    for (const migration of migrations) {
      if (applied.has(migrationKey(scope, migration.name))) continue
      await applyMigration(client, scope, migration)
      changed += 1
    }
  }
  const scanned = migrationCount()
  return { scanned, changed, skipped: scanned - changed, failed: 0, pending: [] }
}

/** How long `applyMigrations` waits for the barrier before refusing. */
export interface MaintenanceLockBound {
  readonly attempts: number
  readonly delayMillis: number
}

export const defaultLockBound: MaintenanceLockBound = { attempts: 10, delayMillis: 300 }

const takeBarrier = async (client: PoolClient, bound: MaintenanceLockBound): Promise<void> => {
  for (let attempt = 1; attempt <= bound.attempts; attempt += 1) {
    if (await tryAcquireMaintenanceLock(client)) return
    if (attempt < bound.attempts) await delay(bound.delayMillis)
  }
  const waited = String(bound.attempts * bound.delayMillis)
  throw new Error(
    `the maintenance barrier is held by another session after ${String(bound.attempts)} attempts `
    + `(${waited}ms): the application is running, stop it before migrating`,
  )
}

/**
 * Write path. Checks a client out, takes the exclusive maintenance barrier for
 * the whole run and gives both back — the only place the barrier is acquired.
 *
 * The barrier is taken with a bounded try: a held barrier fails fast with a
 * message naming the cause instead of blocking forever. The release runs in a
 * `finally` and swallows its own failure, so a dead connection cannot replace
 * the migration error with `Connection terminated`; the client is destroyed in
 * that case rather than returned to the pool.
 */
export const applyMigrations = async (
  pool: Pool,
  bound: MaintenanceLockBound = defaultLockBound,
): Promise<MigrationReport> => {
  const client = await pool.connect()
  let releaseFailure: unknown
  try {
    await takeBarrier(client, bound)
    try {
      return await applyMigrationsOnClient(client)
    } finally {
      try {
        await releaseMaintenanceLock(client)
      } catch (error) {
        // The original failure wins; the connection is no longer trustworthy.
        releaseFailure = error
      }
    }
  } finally {
    if (releaseFailure === undefined) client.release()
    else client.release(releaseFailure instanceof Error ? releaseFailure : new Error("release failed"))
  }
}

/** Ready means: the ledger exists and nothing is pending. */
export const databaseReady = async (executor: SqlExecutor): Promise<boolean> =>
  (await planMigrations(executor)).pending.length === 0 && await ledgerExists(executor)
