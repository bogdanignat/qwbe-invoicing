import { Pool } from "pg"
import type { PoolConfig } from "pg"

import { redactSecrets } from "./postgres-errors.ts"

/**
 * The runtime's connections: one application pool and one separate maintenance
 * connection, both created from explicit typed settings.
 *
 * Why two pools and not one. The running application holds the SHARED
 * maintenance advisory lock for the life of its process, and a session-level
 * advisory lock lives on the connection. If that connection came out of the
 * application pool it would be a checked-out client that never goes back, so the
 * pool of 4 would really be a pool of 3 — and a `statement_timeout` sized for a
 * query would kill the lock wait. The maintenance pool is `max: 1`, has its own
 * (longer, still bounded) statement timeout and no idle reaping.
 *
 * What is NOT here: acquiring the lock at boot, the readiness answer and the
 * HTTP wiring. This module hands out connections; the boot sequence is the
 * integration step's.
 *
 * Every timeout is bounded and every bound is a server-side GUC sent at startup
 * (driver probe g1: in force on the first query, no `SET` round trip), so a
 * query cannot outlive its budget even if the client stops waiting.
 */

export interface PostgresSettings {
  readonly host: string
  readonly port: number
  readonly database: string
  readonly user: string
  /** Read from the secret file by the caller. Never logged, never put in an error. */
  readonly password: string
  /** Application pool size. 4 is the deployed value and the tests' budget. */
  readonly maxConnections?: number
  readonly connectTimeoutMillis?: number
  readonly idleTimeoutMillis?: number
  readonly statementTimeoutMillis?: number
  readonly lockTimeoutMillis?: number
  readonly idleTransactionTimeoutMillis?: number
  /** The maintenance session's own budget: it waits for a lock, not for a query. */
  readonly maintenanceStatementTimeoutMillis?: number
  /** Reported pool-level errors (an idle client dropped by the server). */
  readonly onPoolError?: (message: string) => void
}

const defaults = {
  maxConnections: 4,
  connectTimeoutMillis: 2_000,
  idleTimeoutMillis: 10_000,
  statementTimeoutMillis: 5_000,
  lockTimeoutMillis: 3_000,
  idleTransactionTimeoutMillis: 10_000,
  maintenanceStatementTimeoutMillis: 30_000,
} as const

const baseConfig = (settings: PostgresSettings): PoolConfig => ({
  host: settings.host,
  port: settings.port,
  database: settings.database,
  user: settings.user,
  password: settings.password,
  // The schema is explicit so an inherited search_path cannot decide which
  // table a contract-owned statement means.
  options: "-c search_path=public",
  application_name: "qwbe-invoicing",
  connectionTimeoutMillis: settings.connectTimeoutMillis ?? defaults.connectTimeoutMillis,
  lock_timeout: settings.lockTimeoutMillis ?? defaults.lockTimeoutMillis,
})

/**
 * An idle client that the server drops emits `error` on the pool. Without a
 * listener Node treats it as unhandled and ends the process, so one is always
 * attached; the message is redacted because a connection error carries the
 * configuration it was made with.
 */
const attachErrorHandler = (pool: Pool, settings: PostgresSettings): void => {
  pool.on("error", (error: unknown) => {
    settings.onPoolError?.(redactSecrets(error instanceof Error ? error.message : String(error)))
  })
}

export const createQueryPool = (settings: PostgresSettings): Pool => {
  const pool = new Pool({
    ...baseConfig(settings),
    max: settings.maxConnections ?? defaults.maxConnections,
    idleTimeoutMillis: settings.idleTimeoutMillis ?? defaults.idleTimeoutMillis,
    statement_timeout: settings.statementTimeoutMillis ?? defaults.statementTimeoutMillis,
    idle_in_transaction_session_timeout:
      settings.idleTransactionTimeoutMillis ?? defaults.idleTransactionTimeoutMillis,
  })
  attachErrorHandler(pool, settings)
  return pool
}

export const createMaintenancePool = (settings: PostgresSettings): Pool => {
  const pool = new Pool({
    ...baseConfig(settings),
    max: 1,
    // The lifetime session must not be reaped while it holds the shared lock.
    idleTimeoutMillis: 0,
    statement_timeout: settings.maintenanceStatementTimeoutMillis ?? defaults.maintenanceStatementTimeoutMillis,
  })
  attachErrorHandler(pool, settings)
  return pool
}

/**
 * One memoised `end()` per pool. Verified against the installed driver, not
 * assumed (`pg@8.23.0`, `pg-pool/index.js:488-499` and `127-145`): `end()`
 * rejects with `Called end on pool more than once`, resolves only once
 * `_clients` is empty — so it waits for every checked-out client to come back —
 * and `connect()` rejects with `Cannot use a pool after calling end on the
 * pool` from the first call on. A pool that is ended on its own and again as
 * part of the runtime therefore has to answer the same promise twice.
 */
const endOnce = (pool: Pool): (() => Promise<void>) => {
  let ending: Promise<void> | undefined
  return () => ending ??= pool.end()
}

/**
 * `close` is idempotent on purpose: a disposer reachable from both a signal
 * handler and a `finally` must not turn a second call into a failure. The
 * promise is memoised, so concurrent callers await the same shutdown, and the
 * reported message is redacted — a `pg` shutdown error carries the configuration
 * it was made with.
 */
const closeOnce = (enders: ReadonlyArray<() => Promise<void>>): (() => Promise<void>) => {
  let closing: Promise<void> | undefined
  return () => {
    closing ??= (async () => {
      // Every pool is ended even if the first throws, and the first failure is
      // the one reported: a half-closed runtime leaks a connection.
      const results = await Promise.allSettled(enders.map((end) => end()))
      const failed = results.find((result) => result.status === "rejected")
      if (failed?.status === "rejected") {
        throw new Error(redactSecrets(
          failed.reason instanceof Error ? failed.reason.message : String(failed.reason),
        ))
      }
    })()
    return closing
  }
}

/**
 * Queries and nothing else. A command built from this cannot take the
 * session-level maintenance lock, because there is no connection here to hold it
 * on: the member simply does not exist, so `runtime.maintenance` is a compile
 * error rather than a lock that silently dies when the idle reaper closes the
 * client it lived on.
 */
export interface PostgresQueries {
  /** Application queries and transactions. Size `maxConnections`. */
  readonly pool: Pool
  readonly close: () => Promise<void>
}

/**
 * Queries plus the separate connection the running application holds the SHARED
 * maintenance lock on. Only this shape may be used for the barrier; it is
 * assignable to `PostgresQueries`, so a store factory accepts either.
 */
export interface PostgresRuntime extends PostgresQueries {
  readonly maintenance: Pool
  /**
   * Ends the query pool and nothing else, idempotently. The shutdown sequence
   * needs exactly this and cannot use `close()`: once this resolves, every
   * transaction this process had open has committed or rolled back and
   * `connect()` refuses, so no further `pg_advisory_xact_lock_shared` can be
   * taken on the maintenance barrier — which is what makes giving the barrier
   * up safe. `close()` would also end the maintenance pool, whose one client is
   * checked out for as long as the barrier is held, and so would never resolve.
   */
  readonly closeQueries: () => Promise<void>
}

export const createPostgresRuntime = (settings: PostgresSettings): PostgresRuntime => {
  const pool = createQueryPool(settings)
  const maintenance = createMaintenancePool(settings)
  const endQueries = endOnce(pool)
  const endMaintenance = endOnce(maintenance)
  return {
    pool,
    maintenance,
    closeQueries: closeOnce([endQueries]),
    close: closeOnce([endQueries, endMaintenance]),
  }
}

/**
 * A single-pool runtime, for a command that needs queries and no lock session —
 * and the type says so: no `maintenance`, so the misuse the barrier exists to
 * prevent cannot be written.
 */
export const createQueryRuntime = (settings: PostgresSettings): PostgresQueries => {
  const pool = createQueryPool(settings)
  return { pool, close: closeOnce([endOnce(pool)]) }
}
