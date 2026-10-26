import type { Pool, PoolClient } from "pg"

import { maintenanceLockKey } from "../storage/postgres-maintenance-lock.ts"
import { sessionsLockKey } from "../storage/postgres-transaction.ts"

/**
 * Where browser sessions live now: three statements on the application pool,
 * behind the same two locks every other writer takes.
 *
 * The lock order is the one rule that cannot be relaxed: the SHARED maintenance
 * barrier FIRST, then the EXCLUSIVE session key. Taking the logical lock first
 * would deadlock against `migrate`, which holds the barrier exclusively and then
 * wants the rest. Both are transaction-scoped, so they are released by COMMIT or
 * ROLLBACK and nothing has to remember to unlock.
 *
 * The read path (`find`) takes only the SHARED barrier, never the session key:
 * it is one SELECT by primary key, and under READ COMMITTED a statement sees
 * committed rows only, so the expiry sweep plus insert of `create` and the
 * DELETE of a logout are each observed whole or not at all. A logout that has
 * committed hides the row from every later `find`, exactly as the exclusive
 * key did (a `find` racing a logout was ordered by whoever won the lock, which
 * is the same race), and an expired row the sweep has not reached yet is still
 * refused by `decode`, which compares `expires_at` with the clock. The writers
 * keep the EXCLUSIVE key between themselves. The exclusive read lock let any
 * request with a well-formed invented cookie serialise the owner's requests on
 * a four-connection pool and push them into `lock_timeout` 500s.
 *
 * `created_at`/`expires_at` are `BIGINT`, which `pg` decodes as a **string** —
 * no global type parser is installed, so the conversion is explicit and refuses
 * a value that would not survive a round trip through a JS number.
 */

export interface SessionRecord {
  readonly credentialHash: string
  readonly csrfToken: string
  readonly expiresAt: number
}

export interface SessionStore {
  readonly find: (sessionHash: string) => Promise<SessionRecord | undefined>
  readonly create: (record: {
    readonly sessionHash: string
    readonly credentialHash: string
    readonly csrfToken: string
    readonly createdAt: number
    readonly expiresAt: number
  }) => Promise<void>
  readonly remove: (sessionHash: string) => Promise<boolean>
}

const barrierLock = `SELECT pg_advisory_xact_lock_shared(${String(maintenanceLockKey.classId)}, ${String(maintenanceLockKey.objectId)})`
const sessionsLock = `SELECT pg_advisory_xact_lock(${String(sessionsLockKey.classId)}, ${String(sessionsLockKey.objectId)})`
const readLocks = [barrierLock] as const
const writeLocks = [barrierLock, sessionsLock] as const

/**
 * One transaction, its locks in barrier-first order, release exactly once. A
 * failure after BEGIN rolls back; a client whose ROLLBACK itself fails is
 * destroyed instead of returned to the pool, because a connection with an
 * unknown transaction state would poison the next caller.
 */
const inTransaction = async <Value>(
  pool: Pool,
  locks: ReadonlyArray<string>,
  use: (client: PoolClient) => Promise<Value>,
): Promise<Value> => {
  const client = await pool.connect()
  let poisoned: unknown
  try {
    await client.query("BEGIN")
    try {
      for (const statement of locks) await client.query(statement)
      const value = await use(client)
      await client.query("COMMIT")
      return value
    } catch (error) {
      try {
        await client.query("ROLLBACK")
      } catch (rollbackError) {
        poisoned = rollbackError
      }
      throw error
    }
  } finally {
    if (poisoned === undefined) client.release()
    else client.release(poisoned instanceof Error ? poisoned : new Error("rollback failed"))
  }
}

/** A BIGINT epoch, decoded explicitly: `pg` hands int8 over as text. */
const epoch = (value: unknown): number | undefined => {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

interface SessionRow {
  readonly credential_hash: unknown
  readonly csrf_token: unknown
  readonly expires_at: unknown
}

export const createSessionStore = (pool: Pool): SessionStore => ({
  find: (sessionHash) => inTransaction(pool, readLocks, async (client) => {
    const { rows } = await client.query<SessionRow>(
      "SELECT credential_hash, csrf_token, expires_at FROM browser_sessions WHERE session_hash = $1",
      [sessionHash],
    )
    const row = rows[0]
    if (row === undefined) return undefined
    const expiresAt = epoch(row.expires_at)
    if (typeof row.credential_hash !== "string" || typeof row.csrf_token !== "string" || expiresAt === undefined) {
      return undefined
    }
    return { credentialHash: row.credential_hash, csrfToken: row.csrf_token, expiresAt }
  }),
  create: (record) => inTransaction(pool, writeLocks, async (client) => {
    // Expiry collection happens on the write path, under the same lock, exactly
    // as the SQLite store did it: no background job, no second connection.
    await client.query("DELETE FROM browser_sessions WHERE expires_at <= $1", [record.createdAt])
    await client.query(
      "INSERT INTO browser_sessions (session_hash, credential_hash, csrf_token, created_at, expires_at)"
      + " VALUES ($1, $2, $3, $4, $5)",
      [record.sessionHash, record.credentialHash, record.csrfToken, record.createdAt, record.expiresAt],
    )
  }),
  remove: (sessionHash) => inTransaction(pool, writeLocks, async (client) => {
    const result = await client.query(
      "DELETE FROM browser_sessions WHERE session_hash = $1",
      [sessionHash],
    )
    return result.rowCount === 1
  }),
})
